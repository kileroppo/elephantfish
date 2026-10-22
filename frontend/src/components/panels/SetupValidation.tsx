export interface SetupValidationProps {
  valid: boolean
  errors: string[]
}

export function SetupValidation({ valid, errors }: SetupValidationProps) {
  return (
    <div className="setup-validation-box rounded overflow-hidden">
      {valid ? (
        <div className="validation-banner is-valid flex items-center gap-2 px-3 py-2 rounded text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
          <span className="validation-icon text-sm font-bold text-emerald-600">✓</span>
          <span className="validation-text">盘面完全合规，随时可以开始对局</span>
        </div>
      ) : (
        <div className="validation-banner is-invalid flex flex-col gap-1.5 px-3 py-2 rounded text-xs bg-rose-50 text-rose-900 border border-rose-200">
          <div className="validation-head flex items-center gap-1 font-semibold text-rose-800">
            <span className="validation-icon">注意：</span>
            <span className="validation-title">
              盘面存在 {errors.length} 处不合规（暂无法开始对局）：
            </span>
          </div>
          <ul className="validation-list list-disc list-inside flex flex-col gap-0.5 text-[11.5px] text-rose-800/90 pl-1 m-0">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
