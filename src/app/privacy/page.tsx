export const metadata = {
  title: "Privacy Policy",
};

/**
 * Minimal privacy policy. Exists primarily because eBay's OAuth redirect-URL
 * configuration requires a privacy policy URL. It honestly describes what
 * this single-seller app stores and how eBay data is used.
 */
export default function PrivacyPage() {
  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-8 pb-28 prose prose-zinc dark:prose-invert">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-sm text-zinc-500 mt-1">Last updated: May 2026</p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>
          This application is a personal tool used by a single seller to
          create and manage their own listings on eBay and other marketplaces.
          It is not a multi-tenant service and does not sell, rent, or share
          data with third parties.
        </p>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          What we store
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Photos and descriptions of items the seller intends to list, which
            the seller uploads.
          </li>
          <li>
            Listing data the seller creates (titles, prices, conditions,
            shipping details).
          </li>
          <li>
            OAuth tokens issued by eBay to the seller, used solely to create
            and manage that seller&apos;s own listings on their behalf.
          </li>
        </ul>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          eBay data
        </h2>
        <p>
          We access eBay only on the seller&apos;s behalf, using tokens the
          seller authorizes, to create and manage the seller&apos;s own
          listings. We do not collect or store personal information about eBay
          buyers or other eBay users.
        </p>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Marketplace account deletion
        </h2>
        <p>
          We honor eBay&apos;s Marketplace Account Deletion/Closure
          notifications. Because we do not store personal data about eBay
          buyers or other users, there is no such data to delete; deletion
          notices are acknowledged and logged.
        </p>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Third-party processing
        </h2>
        <p>
          Item photos are sent to Anthropic&apos;s Claude API to generate
          draft listing text. Listing and photo data are stored using Supabase.
          These providers process data only to deliver the app&apos;s
          functionality.
        </p>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Contact
        </h2>
        <p>
          For questions about this policy, contact the app owner directly.
        </p>
      </div>
    </main>
  );
}
