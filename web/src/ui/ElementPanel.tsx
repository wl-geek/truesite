import type { Element } from '../api/types'
import { AskBox } from './AskBox'
import { loadBearingText, propertyRows } from './format'

export type ElementPanelProps = { projectId: string; element: Element; onClose: () => void }

/** Properties of the tapped element (bottom sheet on phones, side panel on wide screens). */
export function ElementPanel({ projectId, element, onClose }: ElementPanelProps) {
  const title = element.name || 'Unnamed element'
  return (
    <aside className="panel element-panel" aria-label={`Properties of ${title}`}>
      <header className="panel-head">
        <div>
          <p className="eyebrow">{element.ifc_class}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close properties">
          ×
        </button>
      </header>
      <dl className="facts">
        <dt>Storey</dt>
        <dd>{element.storey || '—'}</dd>
        <dt>Load bearing</dt>
        <dd>{loadBearingText(element.load_bearing)}</dd>
        <dt>GUID</dt>
        <dd className="mono">{element.guid}</dd>
      </dl>
      <table className="props">
        <caption>Properties</caption>
        <tbody>
          {propertyRows(element).map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Keyed by element: a new element gets a fresh Ask box, so an earlier (or in-flight) answer never shows under it. */}
      <AskBox key={element.guid} projectId={projectId} element={element} />
    </aside>
  )
}
