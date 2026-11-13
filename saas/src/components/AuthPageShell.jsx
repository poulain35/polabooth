import { UserRound } from 'lucide-react';
import { Card } from './ui/card';
import BrandLogo from './BrandLogo';
import { BRAND } from '../lib/instanceBrand';

/** Mise en page des écrans d'accès admin (connexion, mot de passe oublié, nouveau mot de passe). */
export default function AuthPageShell({ title, subtitle, label, icon: Icon = UserRound, children }) {
  return (
    <div className="h-screen flex flex-col relative overflow-hidden">
      {/* Fond dégradé décoratif */}
      <div className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 35%, #fdf4ff 65%, #fff7ed 100%)' }} />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-40 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #a5b4fc, transparent 70%)' }} />
      <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full opacity-30 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #86efac, transparent 70%)' }} />
      <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full opacity-25 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #f0abfc, transparent 70%)' }} />

      <header className="py-4 px-8 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <BrandLogo className="h-9 w-auto" />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-foreground mb-2 leading-tight">{title}</h1>
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
          </div>

          <Card className="w-full px-8 py-6 rounded-3xl shadow-xl">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-primary text-primary-foreground">
              <Icon className="w-6 h-6" />
            </div>
            {label && (
              <p className="text-center text-xs font-medium text-muted-foreground mb-4 uppercase tracking-widest">
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
