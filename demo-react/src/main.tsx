import { createRoot } from 'react-dom/client'
import GetUserMediaMock from "@theopenweb/get-user-media-mock";
import App from './App.tsx'

const urlParams = new URLSearchParams(window.location.search);
window.getUserMediaMock = new GetUserMediaMock();
if (urlParams.get("mock") !== null) {
  window.getUserMediaMock.mock();
  console.log("force mock");
} else {
  window.getUserMediaMock.fallbackMock();
  console.log("fallback mock");
}

createRoot(document.getElementById('root')!).render(
  <App />
)
