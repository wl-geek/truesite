import { useEffect } from 'react'
import { useRoute, type Route } from './router'
import { HomePage } from './ui/HomePage'
import { TopBar } from './ui/TopBar'
import { LivePage } from './ui/LivePage'
import { SamplesPage } from './ui/SamplesPage'
import { ViewerPage } from './ui/ViewerPage'

const TITLES: Record<Route['name'], string> = {
  home: 'TrueSite · AR × BIM × AI for construction',
  viewer: '3D model · TrueSite',
  live: 'Live AR · TrueSite',
  samples: 'Virtual demo · TrueSite',
}

/** Top bar + one page per route, and the page title for each route. */
export default function App() {
  const route = useRoute()
  useEffect(() => {
    document.title = TITLES[route.name]
  }, [route.name])
  return (
    <div className="app">
      <TopBar route={route} />
      {route.name === 'home' && <HomePage />}
      {route.name === 'viewer' && <ViewerPage key={route.projectId ?? ''} projectId={route.projectId} />}
      {route.name === 'live' && <LivePage key={`${route.projectId}/${route.anchorId}`} projectId={route.projectId} anchorId={route.anchorId} />}
      {route.name === 'samples' && <SamplesPage />}
    </div>
  )
}
