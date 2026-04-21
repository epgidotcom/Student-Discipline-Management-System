import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Frontend bootstrap entrypoint.
// Connected to App.jsx as the root application coordinator and index.css for shared styles.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* StrictMode is connected to all child code blocks in App.jsx to surface lifecycle warnings during development. */}
    <App />
  </StrictMode>,
)
