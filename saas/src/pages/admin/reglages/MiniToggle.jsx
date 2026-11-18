import { Switch } from '../../../components/ui/switch';

/** Interrupteur des réglages, déplacé d'AdminSettings (LAB-338) : une seule couleur, celle du thème. */
export default function MiniToggle({ checked, onChange }) {
  return <Switch checked={checked} onCheckedChange={onChange} />;
}
