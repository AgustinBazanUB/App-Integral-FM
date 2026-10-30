const profile = { id: 'user_a', name: 'QA sintético', active: true, role: 'admin', pinnedLocationIds: [] };
export const useAuth = () => ({ profile, user: { uid: 'user_a', email: 'fixture@example.test' }, status: 'ready' });
export const getConnectionSnapshot = () => 'online';
export const subscribeConnection = () => () => {};
export const listLocations = async () => [{ id: 'local_qa', name: 'Local QA sintético', type: 'store', active: true, codePrefix: 'QA', assignedSellerIds: [], enabledDiscountIds: [] }];
export const listLocationStockCounts = async () => ({ local_qa: 0 });
export const savePinnedLocationIds = async () => [];
export const saveManagedLocation = async () => { throw new Error('QA local: guardado deshabilitado; no se accede a Firebase.'); };
export const setLocationLifecycle = async () => { throw new Error('QA local: cambios deshabilitados.'); };
