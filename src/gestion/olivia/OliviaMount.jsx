import { Component, lazy, Suspense } from "react";
import { useAuth } from "../AuthContext";
import { can, canAccessAdministration, canAccessSellerPanel, isPureSeller } from "../permissions";
import { OliviaLauncherPortal } from "./LauncherHost";

const OliviaAssistant = lazy(() => import("./OliviaAssistant"));

class OliviaBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <OliviaLauncherPortal><button type="button" className="fm-button fm-button--secondary" onClick={() => this.setState({ failed: false })}>Reintentar Olivia</button></OliviaLauncherPortal>;
    return this.props.children;
  }
}

export default function OliviaMount() {
  const { status, profile, user } = useAuth();
  if (status !== "ready" || (!canAccessAdministration(profile) && !(isPureSeller(profile) && canAccessSellerPanel(profile)) && !can(profile, "ai", "view"))) return null;
  return <OliviaBoundary key={user.uid}><Suspense fallback={null}><OliviaAssistant /></Suspense></OliviaBoundary>;
}
