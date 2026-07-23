"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function SetupPage() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("Right Inventories");
  const [email, setEmail] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("INV-");
  const [paymentDays, setPaymentDays] = useState("14");
  const [vatRate, setVatRate] = useState("0");

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function initialisePage() {
      setMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      setEmail(user.email || "");

      if (user.user_metadata?.business_name) {
        setBusinessName(user.user_metadata.business_name);
      }

      const { data: existingBusiness, error: businessError } =
        await supabase
          .from("businesses")
          .select("id")
          .eq("owner_user_id", user.id)
          .maybeSingle();

      if (businessError) {
        console.error(businessError);
      }

      if (existingBusiness) {
        router.replace("/");
        return;
      }

      setChecking(false);
    }

    initialisePage();
  }, [router]);

  async function handleSubmit(event) {
    event.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(
          "Your login session has expired. Please sign in again."
        );
      }

      const { data: businessId, error: setupError } =
        await supabase.rpc("create_my_business", {
          p_business_name: businessName.trim(),
          p_email: email.trim() || null,
          p_invoice_prefix: invoicePrefix.trim() || "INV-",
          p_payment_days: Number(paymentDays),
          p_vat_rate: Number(vatRate),
        });

      if (setupError) {
        throw setupError;
      }

      if (!businessId) {
        throw new Error("The business was not created.");
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Setup error:", error);

      setMessage(
        error?.message ||
          "The business could not be created. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <p className="text-slate-500">
            Checking your account...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">
          Set up your business
        </h1>

        <p className="mt-2 text-slate-500">
          These details will be used when creating invoices.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-6"
        >
          <div>
            <label className="mb-2 block text-sm font-semibold">
              Business name
            </label>

            <input
              type="text"
              value={businessName}
              onChange={(event) =>
                setBusinessName(event.target.value)
              }
              required
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold">
              Business email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-semibold">
                Invoice prefix
              </label>

              <input
                type="text"
                value={invoicePrefix}
                onChange={(event) =>
                  setInvoicePrefix(event.target.value)
                }
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Payment days
              </label>

              <input
                type="number"
                min="0"
                value={paymentDays}
                onChange={(event) =>
                  setPaymentDays(event.target.value)
                }
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                VAT rate
              </label>

              <select
                value={vatRate}
                onChange={(event) =>
                  setVatRate(event.target.value)
                }
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              >
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="20">20%</option>
              </select>
            </div>
          </div>

          {message && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Creating business..."
              : "Finish setup"}
          </button>
        </form>
      </div>
    </div>
  );
}