import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initTheme } from './theme/themeEngine'
import { installApiAuth } from './utils/apiAuth'
import OutOfHoursNotice from './components/OutOfHoursNotice'

initTheme()
installApiAuth()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <OutOfHoursNotice />
  </StrictMode>,
)
