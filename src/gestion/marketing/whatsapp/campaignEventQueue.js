export function createCampaignEventQueue(applyEvent) {
  const pendingByCampaign = new Map();

  return function enqueueCampaignEvent(profile, message) {
    const campaignId = String(message?.campaignId || "");
    if (!campaignId) return Promise.resolve({ ignored: true });

    const previous = pendingByCampaign.get(campaignId) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => applyEvent(profile, message));

    pendingByCampaign.set(campaignId, current);
    const cleanup = () => {
      if (pendingByCampaign.get(campaignId) === current) pendingByCampaign.delete(campaignId);
    };
    void current.then(cleanup, cleanup);
    return current;
  };
}
