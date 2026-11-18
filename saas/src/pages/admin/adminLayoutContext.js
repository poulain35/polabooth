import { createContext, useContext } from 'react';

// Vrai quand la page est rendue dans le menu de l'admin (pages accessibles aussi hors session, ex.
// /admin/demandes/:id). Fichier à part : App.jsx le lit sans télécharger AdminLayout.
export const InAdminLayoutContext = createContext(false);
export const useInAdminLayout = () => useContext(InAdminLayoutContext);
