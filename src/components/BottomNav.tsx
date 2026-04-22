"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/capture", label: "Capture", icon: "📷" },
  { href: "/inventory", label: "Inventory", icon: "📋" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-black/95 pb-[env(safe-area-inset-bottom)]">
      <ul className="max-w-3xl mx-auto grid grid-cols-2">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 py-3 text-xs font-medium transition-colors ${
                  active
                    ? "text-zinc-950 dark:text-zinc-50"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
