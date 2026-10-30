import React from 'react';
const context = { route: '/gestion', module: 'administration' };
const noop = () => {};
const visibility = { setAssistantOpen: noop, setReview: noop };
const auth = { user: { uid: 'synthetic-admin', email: 'fixture@example.test' }, profile: { active: true, role: 'admin' } };
export const useAuth = () => auth;
export const useNavigate = () => noop;
export const useOliviaContext = () => context;
export const useOliviaVisibility = () => visibility;
export const OliviaLauncherPortal = ({ children }) => <>{children}</>;
export const Link = ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>;
export function FixtureModule() {
  const [module, setModule] = React.useState('Inicio');
  return <section aria-label="Módulo sintético"><button onClick={() => { context.route = '/gestion/products'; context.module = 'products'; setModule('Productos'); }}>Abrir Productos de prueba</button><h1>{module}</h1>{module === 'Productos' ? <label>Producto ficticio<input defaultValue="Aceite de oliva 500 ml" /></label> : null}</section>;
}
