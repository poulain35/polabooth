import { UserRound } from 'lucide-react';
import { Card } from './ui/card';
import { IconCircle } from './ui/icon-circle';
import ProductLogo from './ProductLogo';
import useProductFavicon from '../hooks/useProductFavicon';
import { BRAND } from '../lib/instanceBrand';

/** Mise en page des écrans d'accès admin (connexion, mot de passe oublié, nouveau mot de passe) : fond uni, une carte. */
export default function AuthPageShell({ title, subtitle, label, icon: Icon = UserRound, children }) {
  useProductFavicon();
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <header className="py-4 px-8 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <ProductLogo className="h-9 w-auto" />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="text-center mb-6">
            <h1 className="text-page-title text-foreground mb-2">{title}</h1>
            {subtitle && <p className="text-muted-foreground text-[13px]">{subtitle}</p>}
          </div>

          <Card className="w-full px-8 py-7">
            <IconCircle tone="navy" className="mx-auto mb-4 flex">
              <Icon />
            </IconCircle>
            {label && (
              <p className="text-center text-xs text-muted-foreground mb-4">
                {label}
              </p>
            )}
            {children}
          </Card>
        </div>
      </main>

      <footer className="py-3 shrink-0 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {BRAND.name}
      </footer>
    </div>
  );
}
