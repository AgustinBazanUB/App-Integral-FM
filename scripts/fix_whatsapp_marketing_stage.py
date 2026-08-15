from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"No se encontró bloque esperado en {path}: {old!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Node ESM tests don't apply Vite's extension resolution.
replace("src/gestion/marketing/whatsapp/campaignDomain.js", 'from "../../customers/customerDomain";', 'from "../../customers/customerDomain.js";')
replace("src/gestion/marketing/whatsapp/excelImport.js", 'from "./campaignDomain";', 'from "./campaignDomain.js";')
replace("src/gestion/marketing/whatsapp/extensionBridge.js", 'from "./campaignDomain";', 'from "./campaignDomain.js";')

# Keep all new plain-JS module imports explicit and directly testable.
replace("src/gestion/marketing/whatsapp/campaignService.js", 'from "../../permissions";', 'from "../../permissions.js";')
replace("src/gestion/marketing/whatsapp/campaignService.js", 'from "../../services/firebase";', 'from "../../services/firebase.js";')
replace("src/gestion/marketing/whatsapp/campaignService.js", 'from "../../services/customerService";', 'from "../../services/customerService.js";')
replace("src/gestion/marketing/whatsapp/campaignService.js", 'from "./campaignDomain";', 'from "./campaignDomain.js";')
replace("src/gestion/marketing/whatsapp/campaignService.js", 'from "./extensionBridge";', 'from "./extensionBridge.js";')

# The review step must use the same real extension health check as the main page.
replace(
    "src/gestion/pages/WhatsAppCampaignsPage.jsx",
    'function CampaignWizard({ profile, extensionStatus, initialCampaign, onClose, onSaved }) {',
    'function CampaignWizard({ profile, extensionStatus, refreshExtension, initialCampaign, onClose, onSaved }) {',
)
replace(
    "src/gestion/pages/WhatsAppCampaignsPage.jsx",
    '<ExtensionStatus status={extensionStatus} refreshing={false} onRefresh={() => {}} />',
    '<ExtensionStatus status={extensionStatus} refreshing={false} onRefresh={refreshExtension} />',
)
replace(
    "src/gestion/pages/WhatsAppCampaignsPage.jsx",
    'if (wizard !== null) return <CampaignWizard profile={profile} extensionStatus={extensionStatus} initialCampaign={wizard?.id ? wizard : null} onClose={() => setWizard(null)} onSaved={() => loadCampaigns()} />;',
    'if (wizard !== null) return <CampaignWizard profile={profile} extensionStatus={extensionStatus} refreshExtension={refreshExtension} initialCampaign={wizard?.id ? wizard : null} onClose={() => setWizard(null)} onSaved={() => loadCampaigns()} />;',
)
