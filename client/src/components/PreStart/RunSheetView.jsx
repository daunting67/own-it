// A read-only, scrollable version of the whole run sheet — for a facilitator
// who wants the script up on a phone/tablet while Otter records, without
// starting a formal briefing (that's what BriefingRunner is for; this never
// saves anything).
export default function RunSheetView({ form }) {
  const sections = form.sections.filter(s => s.number)

  return (
    <div className="ps-runsheet">
      <div className="ps-card">
        <div className="ps-view-section">{form.runSheetRef}</div>
        <div className="ps-help">
          {form.totalMinutes} minutes, {sections.length} sections. Read along while the crew works through it —
          nothing here is saved; file the actual briefing from Pre-Start → From a transcript once Otter has it.
        </div>
      </div>

      {sections.map(section => (
        <div className="ps-card" key={section.id}>
          <div className="ps-runsheet-head">
            <div className="ps-runsheet-title">{section.number}. {section.title}</div>
            {section.minutes && <div className="ps-target">~{section.minutes} min</div>}
          </div>

          {section.why && (
            <div className="ps-why"><span className="ps-why-tag">Why</span>{section.why}</div>
          )}

          {section.lines.length > 0 && (
            <div className="ps-say">
              {section.lines.map(line => (
                <div className="ps-say-line" key={line.ref + line.say}>
                  <span className="ps-say-ref">{line.ref}</span>
                  <div>
                    <div className="ps-say-text">“{line.say}”</div>
                    {line.note && <div className="ps-say-note">{line.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="ps-doc-control">{form.docControl} · run sheet {form.runSheetRef}</div>
    </div>
  )
}
