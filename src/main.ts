import "../styles/main.css";
import { initUi } from "./ui";

// Restore the original deep link after the 404.html SPA fallback redirect.
// The packed path is relative to the deploy base (e.g. "/crypto-lab-timing-sidechannel/"),
// so reconstruct against BASE_URL rather than the server root.
const redirectPath = new URLSearchParams(window.location.search).get("p");
if (redirectPath) {
  const base = import.meta.env.BASE_URL || "/";
  const clean = `${base.replace(/\/$/, "")}/${redirectPath.replace(/^\//, "")}`;
  window.history.replaceState(null, "", clean);
}

initUi();
