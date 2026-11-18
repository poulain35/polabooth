import * as React from 'react';
import { cn } from '../../lib/utils';

// Tableau de l'admin : en-tête en bandeau arrondi, lignes séparées par un filet. Les filets sont portés par
// les cellules (`border-separate`) : une bordure posée sur un <tr> ne s'affiche pas.
const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom border-separate border-spacing-0 text-[13px]", className)} {...props} />
  </div>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr:hover]:bg-transparent", className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child>td]:border-b-0", className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("transition-colors hover:bg-soft data-[state=selected]:bg-muted", className)}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 whitespace-nowrap bg-soft px-3.5 text-left align-middle text-xs font-medium text-muted-foreground first:rounded-l-xl last:rounded-r-xl [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("h-16 border-b border-border px-3.5 py-2 align-middle text-ink [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
