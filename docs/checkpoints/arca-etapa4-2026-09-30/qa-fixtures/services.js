const list=async path=>fetch('/__qa/list?path='+encodeURIComponent(path)).then(r=>r.json());

export const listLocationInventory=async id=>list('locationStock/'+id+'/items');

export const listDiscounts=async()=>[];

export const getLocationsSharedCached=()=>null;

export const getSellerResourcesSharedCached=()=>null;

export const listLocationsShared=()=>list('locations');

export const loadSellerResourcesShared=async()=>({categories:[],discounts:[],zones:[]});
