import { useState, type FormEvent } from 'react'
import { ApiError, ask } from '../api/client'
import type { AskAnswer, Element } from '../api/types'
import { askErrorMessage, citedRows, confidenceNote, MAX_QUESTION, SUGGESTIONS } from './askFormat'

export type AskBoxProps = { projectId: string; element: Element; suggestions?: readonly string[] }

/** Ask Gemini about this element; it answers only from the element's own model data, with the fields cited (spec 4.2 step 6). */
export function AskBox({ projectId, element, suggestions = SUGGESTIONS }: AskBoxProps) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(q: string) {
    const text = q.trim()
    if (!text || busy) return
    setQuestion(text)
    setBusy(true)
    setError(null)
    setAnswer(null)
    try {
      setAnswer(await ask({ project_id: projectId, guid: element.guid, question: text }))
    } catch (e) {
      setError(askErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(question)
  }
  const note = answer ? confidenceNote(answer.confidence) : null

  return (
    <section className="ask-box" aria-label="Ask Gemini about this element">
      <h3 className="ask-title">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2c.6 5.3 4.7 9.4 10 10-5.3.6-9.4 4.7-10 10-.6-5.3-4.7-9.4-10-10 5.3-.6 9.4-4.7 10-10Z" /></svg>
        Ask Gemini about this element
      </h3>
      <p className="ask-sub">Gemini answers from this element's BIM data only and shows which fields it used.</p>
      <form onSubmit={onSubmit} className="ask-form">
        <input type="text" value={question} maxLength={MAX_QUESTION} placeholder={`e.g. ${suggestions[0] ?? "What's the fire rating?"}`}
          onChange={(e) => setQuestion(e.target.value)} aria-label="Your question" disabled={busy} />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>{busy ? 'Asking Gemini…' : 'Ask Gemini'}</button>
      </form>
      <div className="ask-chips">
        {suggestions.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => void submit(s)} disabled={busy}>{s}</button>
        ))}
      </div>
      {error && <p className="status status-error" role="alert">{error}</p>}
      {answer && (
        <div className="ask-answer">
          <p>{answer.answer}</p>
          {note && <p className="warn">{note}</p>}
          {answer.cited_properties.length > 0 && (
            <table className="props">
              <caption>From the model</caption>
              <tbody>
                {citedRows(element, answer.cited_properties).map(([k, v]) => (
                  <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">Gemini's answer, from this element's model data only. Check before you build.</p>
        </div>
      )}
    </section>
  )
}
