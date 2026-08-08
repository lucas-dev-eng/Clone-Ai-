import { useState } from "react";
import { ChevronDown, ChevronUp, Cpu, Terminal, Clock, CheckCircle2, Search, FileCode, ShieldAlert, Code } from "lucide-react";

interface AgentStep {
  iteration: number;
  toolName: string;
  args: any;
  result: any;
  durationMs?: number;
}

interface AgentStepsViewerProps {
  steps: AgentStep[];
}

export default function AgentStepsViewer({ steps }: AgentStepsViewerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (!steps || steps.length === 0) return null;

  const getToolIcon = (name: string) => {
    switch (name) {
      case "consultar_cve":
      case "buscar_vulnerabilidade_cve":
        return <ShieldAlert size={14} className="text-rose-400" />;
      case "checar_headers_seguranca":
        return <Search size={14} className="text-teal-400" />;
      case "revisar_pr":
        return <FileCode size={14} className="text-amber-400" />;
      case "analisar_complexidade":
        return <Code size={14} className="text-[#6D8CFF]" />;
      default:
        return <Terminal size={14} className="text-[#58C7B3]" />;
    }
  };

  const getToolLabel = (name: string) => {
    switch (name) {
      case "consultar_cve":
        return "Consultar CVE Security";
      case "buscar_vulnerabilidade_cve":
        return "Buscar Vulnerabilidade CVE";
      case "checar_headers_seguranca":
        return "Análise de Headers HTTP";
      case "revisar_pr":
        return "Revisão de Pull Request (diff)";
      case "analisar_complexidade":
        return "Complexidade Ciclomática";
      default:
        return name;
    }
  };

  return (
    <div className="mt-4 border border-[#243248] rounded-xl bg-[#0F172A] overflow-hidden shadow-inner">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1E293B]/60 hover:bg-[#1E293B]/90 transition-colors select-none text-left cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded bg-[#58C7B3]/10 text-[#58C7B3]">
            <Cpu size={14} className="animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Loop de Agente Ativo ({steps.length} {steps.length === 1 ? "ação" : "ações"})
            </span>
            <span className="block text-[10px] text-slate-400">
              agent_loop.py integrado com execução real de ferramentas
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {steps.map((_, idx) => (
            <span
              key={idx}
              className="w-1.5 h-1.5 rounded-full bg-[#58C7B3] shadow-[0_0_6px_rgba(88,199,179,0.8)]"
            />
          ))}
          {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="p-3.5 space-y-3.5 border-t border-[#243248]/40 bg-[#0F172A] max-h-[380px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {steps.map((step, index) => {
            const isStepExpanded = expandedStep === index;
            return (
              <div key={index} className="relative pl-6 before:absolute before:left-2 before:top-2.5 before:bottom-[-20px] before:w-0.5 before:bg-slate-700 last:before:hidden">
                {/* Dot marker */}
                <div className="absolute left-0.5 top-1.5 p-0.5 rounded-full bg-slate-800 border border-[#243248] z-10">
                  <CheckCircle2 size={10} className="text-[#58C7B3]" />
                </div>

                {/* Step Box */}
                <div className="rounded-lg border border-[#1E293B] bg-[#131B2E] overflow-hidden transition-all">
                  <div
                    onClick={() => setExpandedStep(isStepExpanded ? null : index)}
                    className="flex items-center justify-between px-3 py-2 bg-[#1E293B]/30 hover:bg-[#1E293B]/50 transition-colors cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] font-mono text-[#58C7B3] bg-[#58C7B3]/10 px-1.5 py-0.5 rounded font-bold">
                        Iteração {step.iteration}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 truncate">
                        {getToolIcon(step.toolName)}
                        <span className="truncate">{getToolLabel(step.toolName)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5 text-[10px] text-slate-400 font-mono">
                      {step.durationMs !== undefined && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {step.durationMs}ms
                        </span>
                      )}
                      {isStepExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </div>

                  {/* Step Details */}
                  {isStepExpanded && (
                    <div className="p-3 border-t border-[#1E293B] space-y-2.5 text-xs text-slate-300 font-mono">
                      {/* Arguments */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                          📥 Parâmetros (Input):
                        </span>
                        <pre className="p-2 rounded bg-slate-950 text-slate-300 overflow-x-auto text-[11px] leading-relaxed max-h-[120px]" style={{ scrollbarWidth: "thin" }}>
                          {JSON.stringify(step.args, null, 2)}
                        </pre>
                      </div>

                      {/* Execution Result */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-[#58C7B3] font-bold uppercase tracking-wider block">
                          📤 Resultado da Ferramenta:
                        </span>
                        <pre className="p-2 rounded bg-slate-950 text-emerald-400 overflow-x-auto text-[11px] leading-relaxed max-h-[160px]" style={{ scrollbarWidth: "thin" }}>
                          {JSON.stringify(step.result?.output || step.result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
