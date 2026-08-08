"""
finetuning_module.py
======================
Fine-tuning leve (LoRA) de um modelo pequeno open-source, usando como
dado de treino exatamente o `dataset_correcoes.jsonl` que o
eval_module.py já vem exportando organicamente.

IMPORTANTE — expectativa realista:
Isso NÃO compete com GPT/Claude/Gemini em conhecimento geral. O
objetivo é especializar um modelo pequeno (ex: Llama 3 8B, Mistral 7B,
Phi-3) numa tarefa ESTREITA sua (ex: "classificar severidade de
achado de scanner no seu formato preferido", "responder no seu tom
específico"). Só vale a pena depois de acumular pelo menos algumas
centenas de exemplos reais de correção — com poucos exemplos, ajustar
o PROMPT ainda rende mais que fine-tuning.

Instalação:
    pip install transformers peft datasets torch accelerate bitsandbytes

Hardware: LoRA em modelo 7-8B roda em GPU com ~16GB VRAM (ou via
quantização 4-bit em GPUs menores). Sem GPU decente, use um serviço
de fine-tuning gerenciado (ex: a própria plataforma do provedor do
modelo base que você escolher).
"""

import json
from datasets import Dataset
from transformers import (
    AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model, TaskType


# ---------------------------------------------------------------------------
# 1. PREPARAÇÃO DO DATASET — a partir do que o eval_module já exportou
# ---------------------------------------------------------------------------

def carregar_dataset_correcoes(caminho_jsonl: str = "./dataset_correcoes.jsonl") -> Dataset:
    exemplos = []
    try:
        with open(caminho_jsonl, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha:
                    continue
                item = json.loads(linha)
                # Formato de instrução: o modelo aprende a ir direto pra
                # resposta CORRIGIDA, não pra resposta que ele errou antes
                texto = (
                    f"### Pergunta:\n{item['pergunta']}\n\n"
                    f"### Resposta:\n{item['resposta_corrigida']}"
                )
                exemplos.append({"texto": texto})
    except FileNotFoundError:
        print(f"⚠️ Arquivo {caminho_jsonl} não encontrado. Certifique-se de exportar o dataset no painel primeiro.")
        return Dataset.from_list([])

    if len(exemplos) < 50:
        print(
            f"⚠️  Atenção: apenas {len(exemplos)} exemplos encontrados. "
            "Fine-tuning com poucos exemplos tende a não compensar o esforço "
            "— considere ajustar o prompt/system_prompt em vez disso até "
            "acumular mais dados reais de correção."
        )

    return Dataset.from_list(exemplos)


# ---------------------------------------------------------------------------
# 2. CONFIGURAÇÃO DO LORA E TREINO
# ---------------------------------------------------------------------------

def treinar_lora(
    modelo_base: str = "meta-llama/Meta-Llama-3-8B-Instruct",
    caminho_dataset: str = "./dataset_correcoes.jsonl",
    caminho_saida: str = "./modelo_especializado_lora",
    epocas: int = 3,
):
    dataset = carregar_dataset_correcoes(caminho_dataset)
    if len(dataset) == 0:
        print("❌ Sem dados suficientes para iniciar o treinamento.")
        return

    print(f"🔄 Carregando Tokenizador para o modelo: {modelo_base}...")
    tokenizer = AutoTokenizer.from_pretrained(modelo_base)
    tokenizer.pad_token = tokenizer.pad_token or tokenizer.eos_token

    print(f"🔄 Carregando Modelo Base: {modelo_base}...")
    modelo = AutoModelForCausalLM.from_pretrained(modelo_base, device_map="auto")

    # LoRA: em vez de re-treinar os bilhões de parâmetros do modelo,
    # treina só um adaptador pequeno (rank r) — viável numa GPU comum,
    # e o resultado é um arquivo de poucos MB, não um modelo inteiro novo
    config_lora = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=["q_proj", "v_proj"],  # ajuste conforme a arquitetura do modelo base
    )
    modelo = get_peft_model(modelo, config_lora)
    modelo.print_trainable_parameters()  # mostra quão pequeno é o treino real

    def tokenizar(exemplo):
        return tokenizer(exemplo["texto"], truncation=True, max_length=512, padding="max_length")

    print("🔄 Tokenizando dataset...")
    dataset_tokenizado = dataset.map(tokenizar, batched=True)

    args_treino = TrainingArguments(
        output_dir=caminho_saida,
        num_train_epochs=epocas,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        logging_steps=10,
        save_strategy="epoch",
        fp16=True,
    )

    trainer = Trainer(
        model=modelo,
        args=args_treino,
        train_dataset=dataset_tokenizado,
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )

    print("🚀 Iniciando o fine-tuning LoRA...")
    trainer.train()
    
    print(f"💾 Salvando adaptador LoRA em: {caminho_saida}...")
    modelo.save_pretrained(caminho_saida)
    tokenizer.save_pretrained(caminho_saida)
    print(f"✅ Adaptador LoRA salvo com sucesso em: {caminho_saida}")


# ---------------------------------------------------------------------------
# 3. COMO ISSO SE ENCAIXA NO RESTO DO SISTEMA
# ---------------------------------------------------------------------------
# O modelo fine-tunado NÃO substitui Claude/GPT/Gemini no seu router —
# ele vira mais um "provedor" especializado (ex: ProvedorModeloLocal),
# usado só pra tarefas estreitas onde ele foi treinado (ex: classificar
# severidade no seu formato). Pro resto, continue usando os modelos
# grandes via API, que sabem muito mais coisa em geral.


if __name__ == "__main__":
    import sys
    # Se o usuário rodar direto, iniciamos o treino lora com o modelo padrão ou fornecido por argumento
    modelo_padrão = "meta-llama/Meta-Llama-3-8B-Instruct"
    if len(sys.argv) > 1:
        modelo_padrão = sys.argv[1]
    
    print("=== INICIANDO MÓDULO DE FINE-TUNING ===")
    print(f"Modelo de Origem: {modelo_padrão}")
    print(f"Dataset de Origem: ./dataset_correcoes.jsonl")
    print("=======================================")
    
    try:
        treinar_lora(modelo_base=modelo_padrão)
    except Exception as e:
        print(f"\n❌ Erro durante o processo de fine-tuning: {e}")
        print("Certifique-se de que as dependências necessárias estão instaladas (pip install transformers peft datasets torch accelerate bitsandbytes).")
