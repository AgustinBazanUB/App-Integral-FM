import { Tabs } from "../../design-system";
import { useLocation, useNavigate } from "../../router";
import "../../styles/meta-ads.css";
import MetaAdsPage from "./MetaAdsPage";
import MetaAdsKnowledgeView from "./MetaAdsKnowledgeView";
import MetaAdsTheoriesView from "./MetaAdsTheoriesView";

const basePath = "/gestion/marketing/meta-ads";
const tabs = [
  { id: "campaigns", label: "Campañas" },
  { id: "knowledge", label: "Conocimiento" },
  { id: "theories", label: "Metodologías" },
];

export default function MetaAdsHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const parts = location.pathname.split("/").filter(Boolean);
  const child = parts[3] || null;
  const nestedId = parts[4] ? decodeURIComponent(parts[4]) : null;
  const section = child === "knowledge" ? "knowledge" : child === "theories" ? "theories" : "campaigns";
  const campaignId = child && !["knowledge", "theories"].includes(child) ? decodeURIComponent(child) : null;

  const changeSection = (next) => {
    navigate(next === "campaigns" ? basePath : `${basePath}/${next}`);
  };

  return (
    <div className="fm-meta-ads-hub">
      <div className="fm-meta-ads-subnav">
        <Tabs tabs={tabs} active={section} onChange={changeSection} />
      </div>
      {section === "knowledge" ? <MetaAdsKnowledgeView /> : null}
      {section === "theories" ? (
        <MetaAdsTheoriesView
          theoryId={nestedId}
          onOpenTheory={(id) => navigate(`${basePath}/theories/${encodeURIComponent(id)}`)}
          onBack={() => navigate(`${basePath}/theories`)}
        />
      ) : null}
      {section === "campaigns" ? <MetaAdsPage campaignId={campaignId} /> : null}
    </div>
  );
}
