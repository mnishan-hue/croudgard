import { AlertCircle, ArrowLeft, Camera } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="panel grid min-h-[420px] place-items-center p-6 text-center">
      <div className="max-w-md"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><AlertCircle size={23}/></span><div className="mt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-primary">Page not found</div><h1 className="mt-2 text-2xl font-semibold">We couldn’t find that screen</h1><p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">The link may be outdated, or this page may have moved. Your live connection is still running.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Link href="/" className="button-primary"><ArrowLeft size={14}/>Return to overview</Link><Link href="/cameras" className="button-secondary"><Camera size={14}/>View cameras</Link></div></div>
    </div>
  );
}
