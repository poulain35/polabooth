import { useMemo } from 'react';
import { useFeatures } from './useFeatures';
import { moduleSlot } from '../features/modules';
import { SALES_TABS } from '../features/adminRoutes';

const order = (id) => {
  const i = SALES_TABS.indexOf(id);
  return i === -1 ? SALES_TABS.length : i;
};

/**
 * Onglets de « Demandes et devis » fournis par les modules installés et disponibles
 * (emplacement sales.tabs : { id, label, Component, props?, count?, description? }), dans l'ordre de la spec.
 * Aucun onglet (construction ouverte, ou booking et prospects inactifs) : l'entrée disparaît.
 */
export function useSalesTabs() {
  const { isAvailable } = useFeatures();
  return useMemo(
    () => moduleSlot('sales.tabs')
      .filter((tab) => isAvailable(tab.feature))
      .sort((a, b) => order(a.id) - order(b.id)),
    [isAvailable],
  );
}

/** Nombre de choses à faire par onglet ({ id: n }), lu par les compteurs fournis par les modules. */
export async function countSalesTodo(tabs) {
  const entries = await Promise.all(tabs.filter((tab) => tab.count).map(async (tab) => {
    try {
      return [tab.id, Number(await tab.count()) || 0];
    } catch {
      return [tab.id, 0];
    }
  }));
  return Object.fromEntries(entries);
}
