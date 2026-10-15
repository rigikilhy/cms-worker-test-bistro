"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  CmsDocument,
  FeaturedDish,
  CmsLink,
  DayKey,
  LocaleKey,
  MenuCategory,
  MenuItem,
  OpeningHour,
  RestaurantInfo,
} from "./types";
import { cmsThemeStyle } from "./config";
import { validCmsContactEmail, validCmsContactPhone } from "./contact-validation";
import type { CmsModuleId, RestaurantCmsConfig } from "./config";

type AdminEditorProps = {
  config: RestaurantCmsConfig;
  initialContent: CmsDocument;
};

type SessionState = {
  authenticated: boolean;
  email?: string;
};

type PublishUsage = { used: number; limit: number; month: string };

type ContentResponse = {
  usage?: PublishUsage;
  content: CmsDocument;
  contentSha?: string;
  message?: string;
  error?: string;
  conflict?: boolean;
  deployRequestId?: string;
  idempotencyKey?: string;
  retryable?: boolean;
};

type DeployStatusResponse = {
  state: "idle" | "pending" | "success" | "failed";
};

type ChangeSummaryItem = {
  label: string;
  detail?: string;
};

type ChangeSummary = {
  general: ChangeSummaryItem[];
  it: ChangeSummaryItem[];
  en: ChangeSummaryItem[];
};

type ScalarSiteField =
  | "phone"
  | "email"
  | "googleMapsUrl"
  | "bookingHref"
  | "orderUrl"
  | "reservationUrl"
  | "instagramUrl"
  | "facebookUrl";

const ROME_TIME_ZONE = "Europe/Rome";
const CHANGE_DETAIL_MAX_LENGTH = 60;
const DEPLOY_STATUS_POLL_MS = 15_000;

type PendingImageUpload = {
  dishId: string;
  file: File;
  path: string;
  previewUrl: string;
  previousPath?: string;
};

const adminCopy = {
  it: {
    privateCms: "CMS privato",
    logOut: "Esci",
    adminSignIn: "Accesso admin",
    email: "Email",
    password: "Password",
    show: "Mostra",
    hide: "Nascondi",
    authenticatorCode: "Codice autenticatore",
    signIn: "Accedi",
    signingIn: "Accesso in corso...",
    signInFailed: "Accesso non riuscito.",
    signedIn: "Accesso effettuato.",
    signedOut: "Uscita effettuata.",
    signInPrompt: "Accedi per modificare i contenuti.",
    contentLoadFailed: "Accesso effettuato, ma il contenuto non e stato caricato.",
    contentLoaded: "Contenuto caricato.",
    localContentLoaded: "Modalità di prova locale. Le chiamate API del CMS sono disattivate.",
    localPublishDisabled: "Modalità di prova locale. La pubblicazione è disattivata.",
    localSaveOnly: "Modifiche salvate solo in questa prova locale; il sito non è stato pubblicato.",
    localSignOutDisabled: "Modalità di prova locale. La disconnessione è disattivata.",
    updateStatusUnavailable: "Stato dell’aggiornamento non disponibile. Contatta l’assistenza se il sito non è aggiornato.",
    updatePending: "Contenuti salvati. Aggiornamento del sito in corso. Tempo previsto: circa 10–15 minuti.",
    updateCheckStopped: "Verifica interrotta. Riapri il CMS per controllare lo stato, oppure contatta l’assistenza.",
    retryUnavailable: "Impossibile riprovare ora. Attendi o contatta l’assistenza.",
    retryQueued: "Aggiornamento salvato nuovamente in coda. Tempo previsto: circa 10–15 minuti.",
    checkingUpdate: "Verifica dello stato dell’aggiornamento…",
    status: "Stato",
    saving: "Salvataggio in corso...",
    saveAndPublish: "Salva e pubblica",
    saveFailed: "Non funziona. Salvataggio non riuscito.",
    saveConfirmed: (time: string) => `Confermato alle ${time}. Aggiornamento del sito avviato. Tempo previsto: circa 10–15 minuti.`,
    publishSucceeded: "Il sito è stato aggiornato correttamente.",
    saveNotWorking: (time: string) => `Non funziona alle ${time}. Il sito non e stato aggiornato.`,
    publishUsageUnavailable: "Limite pubblicazioni non disponibile.",
    publishUsage: (used: number, limit: number, month: string) =>
      `${used} di ${limit} pubblicazioni usate in ${month}`,
    publishNeedsChanges: "Modifica i contenuti prima di pubblicare.",
    contentConflict: "Il contenuto è cambiato altrove. La tua bozza è ancora qui: ricarica solo quando sei pronto a confrontarla.",
    reloadLatest: "Carica la versione più recente",
    changes: "Modifiche",
    noChanges: "Nessuna modifica non salvata.",
    general: "Generale · entrambe le lingue",
    translationReminder: "Ricorda di aggiornare i testi in italiano e inglese. Link, prezzi, orari e immagini sono condivisi.",
    checkEnglish: "Hai modificato solo i testi italiani. Controlla anche la versione inglese prima di salvare.",
    checkItalian: "Hai modificato solo i testi inglesi. Controlla anche la versione italiana prima di salvare.",
    needHelp: "Hai bisogno di aiuto?",
    contactSupport: "Contatta",
    convertImage: "Devi convertire un’immagine?",
    findAvifConverter: "Cerca un convertitore AVIF",
    moreChanges: (count: number) => `+${count} altre`,
    emptyValue: "Vuoto",
    changeDetail: (from: string, to: string) => `${from} -> ${to}`,
    language: "Lingua",
    contents: "Indice",
    backToTop: "Torna su",
    restaurantInfo: "Informazioni ristorante",
    featuredImages: "Immagini in evidenza",
    uploadAvif: "Carica AVIF",
    chooseAvif: "Scegli immagine AVIF",
    pendingImage: "La nuova immagine sarà pubblicata quando salvi.",
    imageRequirements: "Solo file .avif.",
    fileNotSupported: "Il file non è supportato.",
    imageUploadInvalid: "Il file non è supportato. Carica solo immagini .avif.",
    imageTooLarge: "Immagine troppo grande. Usa un file AVIF piu leggero.",
    imageAlt: "Testo alternativo immagine",
    imageAltHelpLead: "Testo alternativo",
    imageAltHelp: "descrive l’immagine agli screen reader e di norma non compare sul sito.",
    imagePlaceholder: "Immagine qui",
    selectedFile: "File selezionato",
    noFileSelected: "Nessun file selezionato",
    removeSelection: "Rimuovi selezione",
    links: "Link",
    orderLinks: "Link ordini",
    socialLinks: "Link social",
    openingHours: "Orari",
    menu: "Menu",
    name: "Nome",
    tagline: "Sottotitolo",
    description: "Descrizione",
    phone: "Telefono",
    invalidPhone: "Inserisci un numero valido (6–15 cifre; puoi usare +, spazi e separatori).",
    invalidContactEmail: "Inserisci un indirizzo email valido, ad esempio nome@dominio.it.",
    invalidContactDetails: "Controlla telefono ed email nelle informazioni del ristorante.",
    bookingLink: "Link prenotazione",
    googleMapsUrl: "Link Google Maps",
    address: "Indirizzo",
    streetAddress: "Via e numero",
    postalCode: "CAP",
    addressLocality: "Comune",
    addressRegion: "Provincia o regione",
    addressCountry: "Paese",
    addLink: "Aggiungi link",
    label: "Etichetta",
    url: "URL",
    remove: "Rimuovi",
    lunchOpen: "Apertura pranzo",
    lunchClose: "Chiusura pranzo",
    dinnerOpen: "Apertura cena",
    dinnerClose: "Chiusura cena",
    closed: "Chiuso",
    addCategory: "Aggiungi categoria",
    openAll: "Apri tutto",
    closeAll: "Chiudi tutto",
    categoryTitle: "Titolo categoria",
    untitledCategory: "Categoria senza nome",
    openCategory: "Apri categoria",
    closeCategory: "Chiudi categoria",
    openSection: "Apri sezione",
    closeSection: "Chiudi sezione",
    addItem: "Aggiungi piatto",
    delete: "Elimina",
    itemName: "Nome piatto",
    price: "Prezzo",
    available: "Disponibile",
    deleteItem: "Elimina piatto",
    itemSingular: "piatto",
    itemPlural: "piatti",
    changedField: (label: string) => `${label} modificato`,
    changedCategory: (name: string) => `Categoria "${name}" modificata`,
    changedItem: (name: string, label: string) => `"${name}": ${label} modificato`,
    addedCategory: (name: string) => `Categoria "${name}" aggiunta`,
    removedCategory: (name: string) => `Categoria "${name}" eliminata`,
    addedItem: (name: string) => `Piatto "${name}" aggiunto`,
    removedItem: (name: string) => `Piatto "${name}" eliminato`,
  },
  en: {
    privateCms: "Private CMS",
    logOut: "Log out",
    adminSignIn: "Admin sign in",
    email: "Email",
    password: "Password",
    show: "Show",
    hide: "Hide",
    authenticatorCode: "Authenticator code",
    signIn: "Sign in",
    signingIn: "Signing in...",
    signInFailed: "Sign in failed.",
    signedIn: "Signed in.",
    signedOut: "Signed out.",
    signInPrompt: "Sign in to edit content.",
    contentLoadFailed: "Signed in, but CMS content could not be loaded.",
    contentLoaded: "Content loaded.",
    localContentLoaded: "Local preview mode. CMS API calls are disabled.",
    localPublishDisabled: "Local preview mode. Publishing is disabled.",
    localSaveOnly: "Changes were saved only in this local preview; the website was not published.",
    localSignOutDisabled: "Local preview mode. Sign out is disabled.",
    updateStatusUnavailable: "Update status unavailable. Contact support if the website is not up to date.",
    updatePending: "Content saved. Website update pending. Expected update time: about 10–15 minutes.",
    updateCheckStopped: "Status checking stopped. Reopen the CMS to check again, or contact support.",
    retryUnavailable: "Unable to retry now. Wait or contact support.",
    retryQueued: "Saved update queued again. Expected update time: about 10–15 minutes.",
    checkingUpdate: "Checking update status…",
    status: "Status",
    saving: "Saving...",
    saveAndPublish: "Save and publish",
    saveFailed: "Not working. Save failed.",
    saveConfirmed: (time: string) => `Confirmed at ${time}. Website update started. Expected update time: about 10–15 minutes.`,
    publishSucceeded: "The website was updated successfully.",
    saveNotWorking: (time: string) => `Not working at ${time}. Website was not updated.`,
    publishUsageUnavailable: "Publish usage unavailable.",
    publishUsage: (used: number, limit: number, month: string) => `${used} of ${limit} publishes used in ${month}`,
    publishNeedsChanges: "Edit content before publishing.",
    contentConflict: "Content changed elsewhere. Your draft is still here: reload only when you are ready to compare it.",
    reloadLatest: "Load latest version",
    changes: "Changes",
    noChanges: "No unsaved changes.",
    general: "General · both languages",
    translationReminder: "Remember to update Italian and English text. Links, prices, opening hours and images are shared.",
    checkEnglish: "You have changed only Italian text. Check the English version before saving too.",
    checkItalian: "You have changed only English text. Check the Italian version before saving too.",
    needHelp: "Need help?",
    contactSupport: "Contact",
    convertImage: "Need to convert an image?",
    findAvifConverter: "Find an AVIF converter",
    moreChanges: (count: number) => `+${count} more`,
    emptyValue: "Empty",
    changeDetail: (from: string, to: string) => `${from} -> ${to}`,
    language: "Language",
    contents: "Contents",
    backToTop: "Back to top",
    restaurantInfo: "Restaurant info",
    featuredImages: "Featured images",
    uploadAvif: "Upload AVIF",
    chooseAvif: "Choose AVIF image",
    pendingImage: "The new image will be published when you save.",
    imageRequirements: "Only .avif files.",
    fileNotSupported: "File not supported.",
    imageUploadInvalid: "File not supported. Upload .avif images only.",
    imageTooLarge: "Image too large. Use a lighter AVIF file.",
    imageAlt: "Image alt text",
    imageAltHelpLead: "Alt text",
    imageAltHelp: "describes the image to screen readers and is normally not visible on the site.",
    imagePlaceholder: "Image here",
    selectedFile: "Selected file",
    noFileSelected: "No file selected",
    removeSelection: "Remove selection",
    links: "Links",
    orderLinks: "Order links",
    socialLinks: "Social links",
    openingHours: "Opening hours",
    menu: "Menu",
    name: "Name",
    tagline: "Tagline",
    description: "Description",
    phone: "Phone",
    invalidPhone: "Enter a valid number (6–15 digits; +, spaces and separators are allowed).",
    invalidContactEmail: "Enter a valid email address, for example name@domain.com.",
    invalidContactDetails: "Check the phone and email in Restaurant info.",
    bookingLink: "Booking link",
    googleMapsUrl: "Google Maps URL",
    address: "Address",
    streetAddress: "Street and number",
    postalCode: "Postcode",
    addressLocality: "Town or city",
    addressRegion: "Province or region",
    addressCountry: "Country",
    addLink: "Add link",
    label: "Label",
    url: "URL",
    remove: "Remove",
    lunchOpen: "Lunch open",
    lunchClose: "Lunch close",
    dinnerOpen: "Dinner open",
    dinnerClose: "Dinner close",
    closed: "Closed",
    addCategory: "Add category",
    openAll: "Open all",
    closeAll: "Close all",
    categoryTitle: "Category title",
    untitledCategory: "Untitled category",
    openCategory: "Open category",
    closeCategory: "Close category",
    openSection: "Open section",
    closeSection: "Close section",
    addItem: "Add item",
    delete: "Delete",
    itemName: "Item name",
    price: "Price",
    available: "Available",
    deleteItem: "Delete item",
    itemSingular: "item",
    itemPlural: "items",
    changedField: (label: string) => `${label} changed`,
    changedCategory: (name: string) => `Category "${name}" changed`,
    changedItem: (name: string, label: string) => `"${name}": ${label} changed`,
    addedCategory: (name: string) => `Category "${name}" added`,
    removedCategory: (name: string) => `Category "${name}" removed`,
    addedItem: (name: string) => `Item "${name}" added`,
    removedItem: (name: string) => `Item "${name}" removed`,
  },
} satisfies Record<LocaleKey, Record<string, unknown>>;

type AdminCopy = (typeof adminCopy)[LocaleKey];
const adminSectionIds = ["restaurant-info", "featured-images", "links", "opening-hours", "menu"] as const;
type AdminSectionId = (typeof adminSectionIds)[number];

const sectionModule: Record<AdminSectionId, CmsModuleId> = {
  "restaurant-info": "restaurantInfo",
  "featured-images": "featuredImages",
  links: "links",
  "opening-hours": "openingHours",
  menu: "menu",
};

const dayLabels: Record<LocaleKey, Array<{ day: DayKey; label: string }>> = {
  it: [
    { day: "monday", label: "Lunedi" },
    { day: "tuesday", label: "Martedi" },
    { day: "wednesday", label: "Mercoledi" },
    { day: "thursday", label: "Giovedi" },
    { day: "friday", label: "Venerdi" },
    { day: "saturday", label: "Sabato" },
    { day: "sunday", label: "Domenica" },
  ],
  en: [
    { day: "monday", label: "Monday" },
    { day: "tuesday", label: "Tuesday" },
    { day: "wednesday", label: "Wednesday" },
    { day: "thursday", label: "Thursday" },
    { day: "friday", label: "Friday" },
    { day: "saturday", label: "Saturday" },
    { day: "sunday", label: "Sunday" },
  ],
};

function initialOpenCategoryIds(content: CmsDocument) {
  return [...content.menuCategories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 1)
    .map((category) => category.id);
}

function isAdminSectionId(value: string): value is AdminSectionId {
  return adminSectionIds.includes(value as AdminSectionId);
}

function addUniqueSection(sectionIds: AdminSectionId[], sectionId: AdminSectionId) {
  return sectionIds.includes(sectionId) ? sectionIds : [...sectionIds, sectionId];
}

export function AdminEditor({ config, initialContent }: AdminEditorProps) {
  const [session, setSession] = useState<SessionState>({ authenticated: false });
  const [content, setContent] = useState<CmsDocument>(initialContent);
  const [savedContent, setSavedContent] = useState<CmsDocument>(initialContent);
  const [contentSha, setContentSha] = useState<string | undefined>();
  const [locale, setLocale] = useState<LocaleKey>(config.defaultLocale);
  const [openSectionIds, setOpenSectionIds] = useState<AdminSectionId[]>(["restaurant-info"]);
  const [openCategoryIds, setOpenCategoryIds] = useState<string[]>(() => initialOpenCategoryIds(initialContent));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usageData, setUsageData] = useState<PublishUsage | null>(null);
  const usageVersion = useRef(0);
  // Store the message description, then translate it on every render.
  const [messageState, setMessageState] = useState<{ render: (copy: AdminCopy) => string }>({
    render: (copy) => copy.signInPrompt,
  });
  const setMessage = useCallback((render: (copy: AdminCopy) => string) => {
    setMessageState({ render });
  }, []);
  const [busy, setBusy] = useState(false);
  const [contactTouched, setContactTouched] = useState({ phone: false, email: false });
  const [pendingImageUploads, setPendingImageUploads] = useState<Record<string, PendingImageUpload>>({});
  const [imageUploadErrors, setImageUploadErrors] = useState<Record<string, string>>({});
  const [conflictContent, setConflictContent] = useState<CmsDocument | null>(null);
  const [conflictSha, setConflictSha] = useState<string | undefined>();
  const [publishKey, setPublishKey] = useState<string | undefined>();
  const [activeDeployKey, setActiveDeployKey] = useState<string | undefined>();
  const [failedDeployKey, setFailedDeployKey] = useState<string | undefined>();

  const rememberDeploy = useCallback((key?: string) => {
    if (!session.email) return;
    try {
      const storageKey = `cms-publish:${config.siteId}:${session.email.toLowerCase()}`;
      if (key) localStorage.setItem(storageKey, key);
      else localStorage.removeItem(storageKey);
    } catch {
      // Storage may be disabled; publishing and in-page status still work.
    }
  }, [config.siteId, session.email]);

  useEffect(() => {
    setActiveDeployKey(undefined);
    setFailedDeployKey(undefined);
    if (!session.authenticated || !session.email) return;
    try {
      const key = localStorage.getItem(`cms-publish:${config.siteId}:${session.email.toLowerCase()}`);
      if (key && /^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/.test(key)) setActiveDeployKey(key);
    } catch {
      // Browser storage is optional.
    }
  }, [config.siteId, session.authenticated, session.email]);

  const copy = adminCopy[locale];
  const phoneError = contactTouched.phone && !validCmsContactPhone(content.site.phone) ? copy.invalidPhone : undefined;
  const emailError = contactTouched.email && !validCmsContactEmail(content.site.email) ? copy.invalidContactEmail : undefined;
  const message = messageState.render(copy);
  const localDevAdmin =
    (process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  const usage = localDevAdmin ? copy.localPublishDisabled
    : usageData ? copy.publishUsage(usageData.used, usageData.limit, formatMonth(usageData.month))
    : copy.publishUsageUnavailable;
  const cmsUploadRoot = `/uploads/cms/${config.siteId}/featured`;
  const maxImageUploadBytes = config.imageGroups.featured.maxFileBytes;

  const sortedHours = useMemo(
    () => [...content.openingHours].sort((a, b) => a.sortOrder - b.sortOrder),
    [content.openingHours],
  );

  const sortedCategories = useMemo(
    () => [...content.menuCategories].sort((a, b) => a.sortOrder - b.sortOrder),
    [content.menuCategories],
  );

  const featuredDishes = useMemo(() => normalizeFeaturedDishes(content), [content]);
  const mainSections = useMemo(
    () => [
      { id: "restaurant-info" as const, label: copy.restaurantInfo },
      { id: "featured-images" as const, label: copy.featuredImages },
      { id: "links" as const, label: copy.links },
      { id: "opening-hours" as const, label: copy.openingHours },
      { id: "menu" as const, label: copy.menu },
    ].filter((section) => config.modules[sectionModule[section.id]]),
    [config.modules, copy],
  );

  const changeSummary = useMemo(
    () => buildChangeSummary(savedContent, content, locale, copy, config.locales),
    [config.locales, content, copy, locale, savedContent],
  );

  const hasChanges =
    changeSummary.general.length > 0 || changeSummary.it.length > 0 || changeSummary.en.length > 0;

  const translationNudge = changeSummary.it.length > 0 && changeSummary.en.length === 0
    ? copy.checkEnglish
    : changeSummary.en.length > 0 && changeSummary.it.length === 0
      ? copy.checkItalian
      : undefined;

  const loadContent = useCallback(async () => {
    if (localDevAdmin) {
      setContent(initialContent);
      setSavedContent(initialContent);
      setContentSha(undefined);
      setOpenCategoryIds(initialOpenCategoryIds(initialContent));
      setPendingImageUploads((current) => {
        revokePendingPreviewUrls(current);
        return {};
      });
      setImageUploadErrors({});
      setConflictContent(null);
      setConflictSha(undefined);
      setMessage((copy) => copy.localContentLoaded);
      return;
    }

    const response = await fetch("/api/cms/content");

    if (!response.ok) {
      setMessage((copy) => copy.contentLoadFailed);
      return;
    }

    const data = (await response.json()) as ContentResponse;
    setContent(data.content);
    setSavedContent(data.content);
    setContentSha(data.contentSha);
    setOpenCategoryIds(initialOpenCategoryIds(data.content));
    setPendingImageUploads((current) => {
      revokePendingPreviewUrls(current);
      return {};
    });
    setImageUploadErrors({});
    setConflictContent(null);
    setConflictSha(undefined);
    setMessage((copy) => copy.contentLoaded);
  }, [initialContent, localDevAdmin, setMessage]);

  const loadUsage = useCallback(async () => {
    const version = ++usageVersion.current;
    if (localDevAdmin) return;
    try {
      const response = await fetch("/api/cms/publish-usage", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as PublishUsage;
      if (version === usageVersion.current) setUsageData(data);
    } catch {
      // Keep the last confirmed count when a usage refresh fails.
    }
  }, [localDevAdmin]);

  const refreshSession = useCallback(async () => {
    if (localDevAdmin) {
      setSession({ authenticated: true, email: "local-preview@example.invalid" });
      await Promise.all([loadContent(), loadUsage()]);
      return;
    }

    const response = await fetch("/api/cms/session");

    if (!response.ok) {
      setSession({ authenticated: false });
      return;
    }

    const nextSession = (await response.json()) as SessionState;
    if (nextSession.authenticated) {
      await Promise.all([loadContent(), loadUsage()]);
    }
    setSession(nextSession);
  }, [loadContent, loadUsage, localDevAdmin]);

  useEffect(() => {
    // Sync the static admin shell with the HttpOnly CMS session cookie on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (localDevAdmin || !session.authenticated || !activeDeployKey) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let checks = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/cms/deploy-status?idempotencyKey=${encodeURIComponent(activeDeployKey)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const data = (await response.json()) as DeployStatusResponse;
          if (cancelled) return;
          if (data.state === "success") {
            setMessage((copy) => copy.publishSucceeded);
            rememberDeploy();
            setFailedDeployKey(undefined);
            setActiveDeployKey(undefined);
            return;
          }
          if (data.state === "failed") {
            const failedAt = formatRomeDateTime(new Date().toISOString()) ?? new Date().toISOString();
            setMessage((copy) => copy.saveNotWorking(failedAt));
            setFailedDeployKey(activeDeployKey);
            setActiveDeployKey(undefined);
            return;
          }
          if (data.state === "idle") {
            rememberDeploy();
            setActiveDeployKey(undefined);
            setMessage((copy) => copy.updateStatusUnavailable);
            return;
          }
          setMessage((copy) => copy.updatePending);
        }
      } catch {
        // A transient status-read failure must not turn an accepted save into a false failure.
      }
      if (cancelled) return;
      if (Date.now() - startedAt >= 35 * 60_000) {
        setActiveDeployKey(undefined);
        setMessage((copy) => copy.updateCheckStopped);
        return;
      }
      timer = setTimeout(poll, Math.min(60_000, DEPLOY_STATUS_POLL_MS * 2 ** Math.min(checks++, 2)));
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeDeployKey, localDevAdmin, session.authenticated, rememberDeploy, setMessage]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (isAdminSectionId(hash)) {
      const frame = window.requestAnimationFrame(() => {
        setOpenSectionIds((current) => addUniqueSection(current, hash));
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);

  function isMainSectionOpen(sectionId: AdminSectionId) {
    return openSectionIds.includes(sectionId);
  }

  function toggleMainSection(sectionId: AdminSectionId) {
    setOpenSectionIds((current) =>
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId],
    );
  }

  function openMainSectionAndScroll(sectionId: AdminSectionId) {
    setOpenSectionIds((current) => addUniqueSection(current, sectionId));
    window.history.replaceState(null, "", `#${sectionId}`);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (localDevAdmin) {
      setSession({ authenticated: true, email: "local-preview@example.invalid" });
      setMessage((copy) => copy.localContentLoaded);
      return;
    }

    setBusy(true);
    setMessage((copy) => copy.signingIn);

    try {
      const response = await fetch("/api/cms/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totp }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage((copy) => data?.error ?? copy.signInFailed);
        return;
      }

      setPassword("");
      setTotp("");
      await refreshSession();
      setMessage((copy) => copy.signedIn);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (localDevAdmin) {
      setSession({ authenticated: true, email: "local-preview@example.invalid" });
      setMessage((copy) => copy.localSignOutDisabled);
      return;
    }

    setBusy(true);

    try {
      await fetch("/api/cms/logout", { method: "POST" });
      setSession({ authenticated: false });
      setActiveDeployKey(undefined);
      setMessage((copy) => copy.signedOut);
    } finally {
      setBusy(false);
    }
  }

  async function saveContent() {
    if (!validCmsContactPhone(content.site.phone) || !validCmsContactEmail(content.site.email)) {
      setContactTouched({ phone: true, email: true });
      setOpenSectionIds((current) => addUniqueSection(current, "restaurant-info"));
      setMessage((copy) => copy.invalidContactDetails);
      return;
    }
    if (localDevAdmin) {
      setSavedContent(content);
      setPendingImageUploads((current) => {
        revokePendingPreviewUrls(current);
        return {};
      });
      setImageUploadErrors({});
      setMessage((copy) => copy.localSaveOnly);
      return;
    }

    setBusy(true);
    setMessage((copy) => copy.saving);

    const nextContent = {
      ...content,
      updatedAt: new Date().toISOString(),
    };
    const idempotencyKey = publishKey ?? crypto.randomUUID();
    setPublishKey(idempotencyKey);

    try {
      const pendingUploads = Object.values(pendingImageUploads);
      const response =
        pendingUploads.length > 0
          ? await fetch("/api/cms/content", {
              method: "POST",
              body: buildImageSaveFormData(nextContent, contentSha, pendingUploads, idempotencyKey),
            })
          : await fetch("/api/cms/content", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: nextContent,
                expectedContentSha: contentSha,
                idempotencyKey,
              }),
            });

      const data = (await response.json().catch(() => null)) as ContentResponse | null;
      const savedAt = formatRomeDateTime(new Date().toISOString()) ?? new Date().toISOString();

      if (!response.ok) {
        if (response.status === 409 && data?.content) {
          setConflictContent(data.content);
          setConflictSha(data.contentSha);
          setMessage((copy) => copy.contentConflict);
        } else {
          setMessage((copy) => data?.error ?? copy.saveFailed);
        }
        return;
      }

      const savedDocument = data?.content ?? nextContent;
      setContent(savedDocument);
      setSavedContent(savedDocument);
      setContentSha(data?.contentSha);
      setPendingImageUploads((current) => {
        revokePendingPreviewUrls(current);
        return {};
      });
      setImageUploadErrors({});
      setConflictContent(null);
      setConflictSha(undefined);
      setPublishKey(undefined);
      rememberDeploy(idempotencyKey);
      setFailedDeployKey(undefined);
      setActiveDeployKey(idempotencyKey);
      setMessage((copy) =>
        data?.message?.toLowerCase().includes("failed")
          ? copy.saveNotWorking(savedAt)
          : copy.saveConfirmed(savedAt),
      );
      if (data?.usage) {
        ++usageVersion.current;
        setUsageData(data.usage);
      } else {
        await loadUsage();
      }
    } finally {
      setBusy(false);
    }
  }

  async function retryDeployment() {
    if (!failedDeployKey || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/cms/retry-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: failedDeployKey }),
      });
      if (!response.ok) {
        setMessage((copy) => copy.retryUnavailable);
        return;
      }
      rememberDeploy(failedDeployKey);
      setActiveDeployKey(failedDeployKey);
      setFailedDeployKey(undefined);
      setMessage((copy) => copy.retryQueued);
    } catch {
      // The retry may have been accepted even when its response was lost.
      // Reconcile status instead of dispatching the same update again.
      setActiveDeployKey(failedDeployKey);
      setFailedDeployKey(undefined);
      setMessage((copy) => copy.checkingUpdate);
    } finally {
      setBusy(false);
    }
  }

  function loadConflictVersion() {
    if (!conflictContent) return;
    setContent(conflictContent);
    setSavedContent(conflictContent);
    setContentSha(conflictSha);
    setConflictContent(null);
    setConflictSha(undefined);
    setPublishKey(undefined);
    setPendingImageUploads((current) => {
      revokePendingPreviewUrls(current);
      return {};
    });
    setImageUploadErrors({});
    setMessage((copy) => copy.contentLoaded);
  }

  function updateSiteField(field: ScalarSiteField, value: string) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        [field]: value,
      },
    }));
  }

  function updateAddressField(
    field: "streetAddress" | "postalCode" | "addressLocality" | "addressRegion" | "addressCountry",
    value: string,
  ) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        address: {
          streetAddress: current.site.address?.streetAddress ?? "",
          postalCode: current.site.address?.postalCode ?? "",
          addressLocality: current.site.address?.addressLocality ?? "",
          addressCountry: current.site.address?.addressCountry ?? "IT",
          ...current.site.address,
          [field]: value,
        },
      },
    }));
  }

  function updateLocalizedSiteField(
    field: keyof Pick<
      RestaurantInfo,
      "name" | "tagline" | "description"
    >,
    value: string,
  ) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        [field]: {
          ...current.site[field],
          [locale]: value,
        },
      },
    }));
  }

  function updateFeaturedDishText(dishId: string, field: "name" | "alt", value: string) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        featuredDishes: normalizeFeaturedDishes(current).map((dish) =>
          dish.id === dishId
            ? {
                ...dish,
                ...(field === "name"
                  ? {
                      name: {
                        ...dish.name,
                        [locale]: value,
                      },
                    }
                  : {
                      image: {
                        ...dish.image,
                        alt: {
                          ...dish.image.alt,
                          [locale]: value,
                        },
                      },
                    }),
              }
            : dish,
        ),
      },
    }));
  }

  function selectFeaturedDishImage(dish: FeaturedDish, file: File | undefined) {
    if (!file) {
      return;
    }

    const validType = !file.type || file.type === "image/avif";
    if (!file.name.toLowerCase().endsWith(".avif") || !validType) {
      setImageUploadErrors((current) => ({ ...current, [dish.id]: String(copy.imageUploadInvalid) }));
      setMessage((copy) => String(copy.fileNotSupported));
      return;
    }

    if (file.size > maxImageUploadBytes) {
      setImageUploadErrors((current) => ({ ...current, [dish.id]: String(copy.imageTooLarge) }));
      setMessage((copy) => String(copy.imageTooLarge));
      return;
    }

    const path = `${cmsUploadRoot}/${dish.id}-${file.lastModified.toString(36)}-${file.size.toString(36)}.avif`;
    const previewUrl = URL.createObjectURL(file);

    setImageUploadErrors((current) => {
      const next = { ...current };
      delete next[dish.id];
      return next;
    });

    setPendingImageUploads((current) => {
      const previous = current[dish.id];
      if (previous) {
        URL.revokeObjectURL(previous.previewUrl);
      }

      return {
        ...current,
        [dish.id]: {
          dishId: dish.id,
          file,
          path,
          previewUrl,
          previousPath: dish.image.path,
        },
      };
    });

    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        featuredDishes: normalizeFeaturedDishes(current).map((currentDish) =>
          currentDish.id === dish.id
            ? {
                ...currentDish,
                image: {
                  ...currentDish.image,
                  path,
                },
              }
            : currentDish,
        ),
      },
    }));
  }

  function undoFeaturedDishImage(dishId: string) {
    const upload = pendingImageUploads[dishId];
    if (!upload) {
      return;
    }

    URL.revokeObjectURL(upload.previewUrl);
    setPendingImageUploads((current) => {
      const next = { ...current };
      delete next[dishId];
      return next;
    });
    setImageUploadErrors((current) => {
      const next = { ...current };
      delete next[dishId];
      return next;
    });
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        featuredDishes: normalizeFeaturedDishes(current).map((dish) =>
          dish.id === dishId
            ? {
                ...dish,
                image: {
                  ...dish.image,
                  path: upload.previousPath ?? dish.image.path,
                },
              }
            : dish,
        ),
      },
    }));
  }

  function updateLink(collection: "orderLinks" | "socialLinks", index: number, field: keyof CmsLink, value: string) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        [collection]: (current.site[collection] ?? []).map((link, linkIndex) =>
          linkIndex === index ? { ...link, [field]: value } : link,
        ),
      },
    }));
  }

  function addLink(collection: "orderLinks" | "socialLinks") {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        [collection]: [...(current.site[collection] ?? []), { label: "New link", href: "https://" }],
      },
    }));
  }

  function removeLink(collection: "orderLinks" | "socialLinks", index: number) {
    setContent((current) => ({
      ...current,
      site: {
        ...current.site,
        [collection]: (current.site[collection] ?? []).filter((_, linkIndex) => linkIndex !== index),
      },
    }));
  }

  function updateHour(dayKey: DayKey, field: keyof OpeningHour, value: string | boolean) {
    setContent((current) => ({
      ...current,
      openingHours: current.openingHours.map((entry) =>
        entry.dayKey === dayKey ? { ...entry, [field]: value } : entry,
      ),
    }));
  }

  function updateCategory(categoryId: string, value: string) {
    setContent((current) => ({
      ...current,
      menuCategories: current.menuCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              title: {
                ...category.title,
                [locale]: value,
              },
            }
          : category,
      ),
    }));
  }

  function updateItem(
    categoryId: string,
    itemId: string,
    field: "name" | "description" | "price" | "available",
    value: string | boolean,
  ) {
    setContent((current) => ({
      ...current,
      menuCategories: current.menuCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              items: category.items.map((item) =>
                item.id === itemId ? updateItemValue(item, field, value, locale) : item,
              ),
            }
          : category,
      ),
    }));
  }

  function addCategory() {
    const nextId = `category-${Date.now()}`;
    setContent((current) => {
      const nextNumber = current.menuCategories.length + 1;
      const category: MenuCategory = {
        id: nextId,
        title: { it: `Categoria ${nextNumber}`, en: `Category ${nextNumber}` },
        sortOrder: nextNumber,
        items: [],
      };

      return {
        ...current,
        menuCategories: [...current.menuCategories, category],
      };
    });
    setOpenCategoryIds((current) => [...new Set([...current, nextId])]);
  }

  function removeCategory(categoryId: string) {
    setContent((current) => ({
      ...current,
      menuCategories: current.menuCategories.filter((category) => category.id !== categoryId),
    }));
    setOpenCategoryIds((current) => current.filter((id) => id !== categoryId));
  }

  function addItem(categoryId: string) {
    setContent((current) => ({
      ...current,
      menuCategories: current.menuCategories.map((category) => {
        if (category.id !== categoryId) {
          return category;
        }

        const nextNumber = category.items.length + 1;
        const item: MenuItem = {
          id: `${categoryId}-item-${Date.now()}`,
          name: { it: `Voce ${nextNumber}`, en: `Item ${nextNumber}` },
          description: { it: "", en: "" },
          price: "0,00 EUR",
          available: true,
          sortOrder: nextNumber,
        };

        return {
          ...category,
          items: [...category.items, item],
        };
      }),
    }));
    setOpenCategoryIds((current) => [...new Set([...current, categoryId])]);
  }

  function removeItem(categoryId: string, itemId: string) {
    setContent((current) => ({
      ...current,
      menuCategories: current.menuCategories.map((category) =>
        category.id === categoryId
          ? { ...category, items: category.items.filter((item) => item.id !== itemId) }
          : category,
      ),
    }));
  }

  function toggleCategory(categoryId: string) {
    setOpenCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  }

  function expandAllCategories() {
    setOpenCategoryIds(sortedCategories.map((category) => category.id));
  }

  function collapseAllCategories() {
    setOpenCategoryIds([]);
  }

  return (
    <div className="admin-shell" style={cmsThemeStyle(config)}>
      <header className="admin-header">
        <div>
          <p>{config.restaurantName}</p>
          <h1>{copy.privateCms}</h1>
        </div>
        {session.authenticated ? (
          <button className="admin-button secondary" disabled={busy} onClick={logout} type="button">
            {copy.logOut}
          </button>
        ) : null}
      </header>

      <main className="admin-layout">
        {!session.authenticated ? (
          <form className="admin-panel login-panel" onSubmit={login}>
            <h2>{copy.adminSignIn}</h2>
            <label>
              {copy.email}
              <input
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
            <label>
              {copy.password}
              <span className="password-row">
                <input
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? copy.hide : copy.show}
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? copy.hide : copy.show}
                  type="button"
                >
                  {/* The supplied password-visibility assets keep both states visually consistent. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="password-eye-icon"
                    src={
                      showPassword
                        ? "/admin-icons/eye_open_pass.svg"
                        : "/admin-icons/eye_close_pass.svg"
                    }
                  />
                </button>
              </span>
            </label>
            <label>
              {copy.authenticatorCode}
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setTotp(event.target.value)}
                pattern="[0-9]{6}"
                type="text"
                value={totp}
              />
            </label>
            <button className="admin-button" disabled={busy} type="submit">
              {copy.signIn}
            </button>
            <p className="admin-message">{message}</p>
          </form>
        ) : (
          <>
            <aside className="admin-panel admin-status">
              <h2>{copy.status}</h2>
              <p>{message}</p>
              {failedDeployKey ? (
                <div>
                  <button className="admin-button secondary" disabled={busy} onClick={retryDeployment} type="button">
                    {locale === "it" ? "Riprova aggiornamento sito" : "Retry website update"}
                  </button>
                  <p className="admin-help-text">
                    {locale === "it"
                      ? "Riprova i contenuti già salvati, senza usare un’altra pubblicazione. Le modifiche non salvate non sono incluse."
                      : "Retry saved content without using another publication. Unsaved edits are not included."}
                  </p>
                </div>
              ) : null}
              {conflictContent ? (
                <button className="admin-button secondary" onClick={loadConflictVersion} type="button">
                  {copy.reloadLatest}
                </button>
              ) : null}
              <p>{usage}</p>

              <ChangeSummaryPanel copy={copy} hasChanges={hasChanges} summary={changeSummary} />

              <div className="locale-tabs" role="group" aria-label={copy.language}>
                {config.locales.map((item) => (
                  <button
                    aria-pressed={locale === item}
                    aria-label={item === "it" ? "Italiano" : "English"}
                    title={item === "it" ? "Italiano" : "English"}
                    key={item}
                    onClick={() => setLocale(item)}
                    type="button"
                  >
                    {item.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="admin-language-help">
                <p>{copy.translationReminder}</p>
                {translationNudge ? <p className="admin-translation-nudge" role="status">{translationNudge}</p> : null}
              </div>
              <span
                className="publish-action-wrap"
                data-tooltip={!hasChanges ? String(copy.publishNeedsChanges) : undefined}
              >
                <button
                  aria-describedby={!hasChanges ? "publish-disabled-hint" : undefined}
                  className="admin-button"
                  disabled={busy || !hasChanges}
                  onClick={saveContent}
                  type="button"
                >
                  {copy.saveAndPublish}
                </button>
              </span>
              {!hasChanges ? (
                <span className="sr-only" id="publish-disabled-hint">
                  {copy.publishNeedsChanges}
                </span>
              ) : null}

              <nav className="admin-toc" aria-label={copy.contents}>
                <h3>{copy.contents}</h3>
                {mainSections.map((section) => (
                  <button
                    aria-expanded={isMainSectionOpen(section.id)}
                    key={section.id}
                    onClick={() => openMainSectionAndScroll(section.id)}
                    type="button"
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
              <section className="admin-support" aria-label={copy.needHelp}>
                <h3>{copy.needHelp}</h3>
                <p>{copy.contactSupport} <a href="mailto:clienti@chiuel.it">clienti@chiuel.it</a></p>
              </section>
            </aside>

            <section className="admin-panel editor-panel">
              <section className="admin-editor-section" hidden={!config.modules.restaurantInfo} id="restaurant-info">
                <h2 className="main-section-heading">
                  <button
                    aria-controls="restaurant-info-panel"
                    aria-expanded={isMainSectionOpen("restaurant-info")}
                    aria-label={`${isMainSectionOpen("restaurant-info") ? copy.closeSection : copy.openSection}: ${copy.restaurantInfo}`}
                    className="main-section-toggle"
                    onClick={() => toggleMainSection("restaurant-info")}
                    type="button"
                  >
                    <span className="category-toggle-icon" aria-hidden="true" />
                    <span>{copy.restaurantInfo}</span>
                  </button>
                </h2>
                {isMainSectionOpen("restaurant-info") ? (
                  <div className="main-section-panel" id="restaurant-info-panel">
                    <div className="admin-grid two">
                      <LocalizedInput
                        label={copy.name}
                        onChange={(value) => updateLocalizedSiteField("name", value)}
                        value={content.site.name[locale] ?? ""}
                      />
                      <LocalizedInput
                        label={copy.tagline}
                        onChange={(value) => updateLocalizedSiteField("tagline", value)}
                        value={content.site.tagline?.[locale] ?? ""}
                      />
                    </div>
                    <LocalizedTextarea
                      label={copy.description}
                      onChange={(value) => updateLocalizedSiteField("description", value)}
                      value={content.site.description?.[locale] ?? ""}
                    />
                    <div className="admin-grid two">
                      <PlainInput
                        autoComplete="tel"
                        error={phoneError}
                        id="cms-contact-phone"
                        label={copy.phone}
                        onBlur={() => setContactTouched((current) => ({ ...current, phone: true }))}
                        onChange={(value) => updateSiteField("phone", value)}
                        type="tel"
                        value={content.site.phone ?? ""}
                      />
                      <PlainInput
                        autoComplete="email"
                        error={emailError}
                        id="cms-contact-email"
                        label={copy.email}
                        onBlur={() => setContactTouched((current) => ({ ...current, email: true }))}
                        onChange={(value) => updateSiteField("email", value)}
                        type="email"
                        value={content.site.email ?? ""}
                      />
                      <PlainInput
                        label={copy.bookingLink}
                        onChange={(value) => updateSiteField("bookingHref", value)}
                        value={content.site.bookingHref ?? ""}
                      />
                      <PlainInput
                        label={copy.googleMapsUrl}
                        onChange={(value) => updateSiteField("googleMapsUrl", value)}
                        value={content.site.googleMapsUrl ?? ""}
                      />
                    </div>
                    <div className="admin-grid two">
                      <PlainInput
                        label={copy.streetAddress}
                        onChange={(value) => updateAddressField("streetAddress", value)}
                        value={content.site.address?.streetAddress ?? ""}
                      />
                      <PlainInput
                        label={copy.postalCode}
                        onChange={(value) => updateAddressField("postalCode", value)}
                        value={content.site.address?.postalCode ?? ""}
                      />
                      <PlainInput
                        label={copy.addressLocality}
                        onChange={(value) => updateAddressField("addressLocality", value)}
                        value={content.site.address?.addressLocality ?? ""}
                      />
                      <PlainInput
                        label={copy.addressRegion}
                        onChange={(value) => updateAddressField("addressRegion", value)}
                        value={content.site.address?.addressRegion ?? ""}
                      />
                      <PlainInput
                        label={copy.addressCountry}
                        onChange={(value) => updateAddressField("addressCountry", value)}
                        value={content.site.address?.addressCountry ?? "IT"}
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="admin-editor-section" hidden={!config.modules.featuredImages} id="featured-images">
                <h2 className="main-section-heading">
                  <button
                    aria-controls="featured-images-panel"
                    aria-expanded={isMainSectionOpen("featured-images")}
                    aria-label={`${isMainSectionOpen("featured-images") ? copy.closeSection : copy.openSection}: ${copy.featuredImages}`}
                    className="main-section-toggle"
                    onClick={() => toggleMainSection("featured-images")}
                    type="button"
                  >
                    <span className="category-toggle-icon" aria-hidden="true" />
                    <span>{copy.featuredImages}</span>
                  </button>
                </h2>
                {isMainSectionOpen("featured-images") ? (
                  <div className="main-section-panel" id="featured-images-panel">
                    <div className="image-guidance">
                      <p>{copy.imageRequirements}</p>
                      <p className="admin-image-help">
                        {copy.convertImage}{" "}
                        <a href="https://www.google.com/search?q=convertitore+in+avif" target="_blank" rel="noopener noreferrer">
                          {copy.findAvifConverter} <span aria-hidden="true">↗</span>
                        </a>
                      </p>
                    </div>
                    <div className="image-guidance">
                      <p><span className="image-guidance-lead">{copy.imageAltHelpLead}</span>: {copy.imageAltHelp}</p>
                    </div>
                    <div className="featured-image-editor">
                      {featuredDishes.map((dish) => (
                        <FeaturedDishImageEditor
                          copy={copy}
                          dish={dish}
                          key={dish.id}
                          locale={locale}
                          error={imageUploadErrors[dish.id]}
                          onImageSelect={(file) => selectFeaturedDishImage(dish, file)}
                          onTextUpdate={(field, value) => updateFeaturedDishText(dish.id, field, value)}
                          onUndo={() => undoFeaturedDishImage(dish.id)}
                          pendingUpload={pendingImageUploads[dish.id]}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="admin-editor-section" hidden={!config.modules.links} id="links">
                <h2 className="main-section-heading">
                  <button
                    aria-controls="links-panel"
                    aria-expanded={isMainSectionOpen("links")}
                    aria-label={`${isMainSectionOpen("links") ? copy.closeSection : copy.openSection}: ${copy.links}`}
                    className="main-section-toggle"
                    onClick={() => toggleMainSection("links")}
                    type="button"
                  >
                    <span className="category-toggle-icon" aria-hidden="true" />
                    <span>{copy.links}</span>
                  </button>
                </h2>
                {isMainSectionOpen("links") ? (
                  <div className="main-section-panel" id="links-panel">
                    <LinkEditor
                      copy={copy}
                      links={content.site.orderLinks ?? []}
                      onAdd={() => addLink("orderLinks")}
                      onRemove={(index) => removeLink("orderLinks", index)}
                      onUpdate={(index, field, value) => updateLink("orderLinks", index, field, value)}
                      title={copy.orderLinks}
                    />
                    <LinkEditor
                      copy={copy}
                      links={content.site.socialLinks ?? []}
                      onAdd={() => addLink("socialLinks")}
                      onRemove={(index) => removeLink("socialLinks", index)}
                      onUpdate={(index, field, value) => updateLink("socialLinks", index, field, value)}
                      title={copy.socialLinks}
                    />
                  </div>
                ) : null}
              </section>

              <section className="admin-editor-section" hidden={!config.modules.openingHours} id="opening-hours">
                <h2 className="main-section-heading">
                  <button
                    aria-controls="opening-hours-panel"
                    aria-expanded={isMainSectionOpen("opening-hours")}
                    aria-label={`${isMainSectionOpen("opening-hours") ? copy.closeSection : copy.openSection}: ${copy.openingHours}`}
                    className="main-section-toggle"
                    onClick={() => toggleMainSection("opening-hours")}
                    type="button"
                  >
                    <span className="category-toggle-icon" aria-hidden="true" />
                    <span>{copy.openingHours}</span>
                  </button>
                </h2>
                {isMainSectionOpen("opening-hours") ? (
                  <div className="main-section-panel hours-editor" id="opening-hours-panel">
                    {dayLabels[locale].map(({ day, label }) => {
                      const entry = sortedHours.find((hour) => hour.dayKey === day);

                      if (!entry) {
                        return null;
                      }

                      return (
                        <div className="hour-row" key={day}>
                          <p>{label}</p>
                          <input
                            aria-label={`${label} ${copy.lunchOpen}`}
                            onChange={(event) => updateHour(day, "lunchOpen", event.target.value)}
                            type="time"
                            value={entry.lunchOpen ?? ""}
                          />
                          <input
                            aria-label={`${label} ${copy.lunchClose}`}
                            onChange={(event) => updateHour(day, "lunchClose", event.target.value)}
                            type="time"
                            value={entry.lunchClose ?? ""}
                          />
                          <input
                            aria-label={`${label} ${copy.dinnerOpen}`}
                            onChange={(event) => updateHour(day, "dinnerOpen", event.target.value)}
                            type="time"
                            value={entry.dinnerOpen ?? ""}
                          />
                          <input
                            aria-label={`${label} ${copy.dinnerClose}`}
                            onChange={(event) => updateHour(day, "dinnerClose", event.target.value)}
                            type="time"
                            value={entry.dinnerClose ?? ""}
                          />
                          <label className="inline-check">
                            <input
                              checked={entry.closed ?? false}
                              onChange={(event) => updateHour(day, "closed", event.target.checked)}
                              type="checkbox"
                            />
                            {copy.closed}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              <section className="admin-editor-section" hidden={!config.modules.menu} id="menu">
                <h2 className="main-section-heading">
                  <button
                    aria-controls="menu-panel"
                    aria-expanded={isMainSectionOpen("menu")}
                    aria-label={`${isMainSectionOpen("menu") ? copy.closeSection : copy.openSection}: ${copy.menu}`}
                    className="main-section-toggle"
                    onClick={() => toggleMainSection("menu")}
                    type="button"
                  >
                    <span className="category-toggle-icon" aria-hidden="true" />
                    <span>{copy.menu}</span>
                  </button>
                </h2>
                {isMainSectionOpen("menu") ? (
                  <div className="main-section-panel" id="menu-panel">
                    <div className="admin-section-title">
                      <div />
                      <div className="admin-button-row">
                        <button className="admin-button secondary" onClick={expandAllCategories} type="button">
                          {copy.openAll}
                        </button>
                        <button className="admin-button secondary" onClick={collapseAllCategories} type="button">
                          {copy.closeAll}
                        </button>
                        <button className="admin-button secondary" onClick={addCategory} type="button">
                          {copy.addCategory}
                        </button>
                      </div>
                    </div>
                    <div className="menu-editor">
                  {sortedCategories.map((category) => {
                    const isOpen = openCategoryIds.includes(category.id);
                    const categoryTitle = category.title[locale] || copy.untitledCategory;

                    return (
                      <section className="category-editor" key={category.id}>
                        <button
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? copy.closeCategory : copy.openCategory}: ${categoryTitle}`}
                          className="category-toggle"
                          onClick={() => toggleCategory(category.id)}
                          type="button"
                        >
                          <span className="category-toggle-icon" aria-hidden="true" />
                          <span>{categoryTitle}</span>
                          <span className="category-count">{formatItemCount(category.items.length, copy)}</span>
                        </button>
                        {isOpen ? (
                          <div className="category-panel">
                            <div className="admin-section-title">
                              <LocalizedInput
                                label={copy.categoryTitle}
                                onChange={(value) => updateCategory(category.id, value)}
                                value={category.title[locale] ?? ""}
                              />
                              <div className="admin-button-row">
                                <button
                                  className="admin-button secondary"
                                  onClick={() => addItem(category.id)}
                                  type="button"
                                >
                                  {copy.addItem}
                                </button>
                                <button
                                  className="admin-button danger"
                                  onClick={() => removeCategory(category.id)}
                                  type="button"
                                >
                                  {copy.delete}
                                </button>
                              </div>
                            </div>
                            {category.items
                              .slice()
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((item) => (
                                <div className="item-editor" key={item.id}>
                                  <LocalizedInput
                                    label={copy.itemName}
                                    onChange={(value) => updateItem(category.id, item.id, "name", value)}
                                    value={item.name[locale] ?? ""}
                                  />
                                  <PlainInput
                                    label={copy.price}
                                    onChange={(value) => updateItem(category.id, item.id, "price", value)}
                                    value={item.price}
                                  />
                                  <LocalizedTextarea
                                    label={copy.description}
                                    onChange={(value) =>
                                      updateItem(category.id, item.id, "description", value)
                                    }
                                    value={item.description?.[locale] ?? ""}
                                  />
                                  <div className="item-controls">
                                    <label className="inline-check">
                                      <input
                                        checked={item.available ?? true}
                                        onChange={(event) =>
                                          updateItem(category.id, item.id, "available", event.target.checked)
                                        }
                                        type="checkbox"
                                      />
                                      {copy.available}
                                    </label>
                                    <button
                                      className="admin-button danger"
                                      onClick={() => removeItem(category.id, item.id)}
                                      type="button"
                                    >
                                      {copy.deleteItem}
                                    </button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                    </div>
                  </div>
                ) : null}
              </section>

            </section>
            <button
              aria-label={copy.backToTop}
              className="back-to-top-button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              title={copy.backToTop}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function ChangeSummaryPanel({
  copy,
  hasChanges,
  summary,
}: {
  copy: AdminCopy;
  hasChanges: boolean;
  summary: ChangeSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const changeCount = summary.general.length + summary.it.length + summary.en.length;
  return (
    <section className="change-summary" aria-live="polite">
      <h3>
        <button
          className="main-section-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls="cms-change-details"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="category-toggle-icon" aria-hidden="true" />
          <span>{copy.changes}{hasChanges ? ` (${changeCount})` : ""}</span>
        </button>
      </h3>
      {!hasChanges ? <p>{copy.noChanges}</p> : null}
      <div id="cms-change-details" hidden={!expanded}>
        <ChangeSummaryList copy={copy} items={summary.general} title={copy.general} />
        <ChangeSummaryList copy={copy} items={summary.it} title="IT" />
        <ChangeSummaryList copy={copy} items={summary.en} title="EN" />
      </div>
    </section>
  );
}

function ChangeSummaryList({
  copy,
  items,
  title,
}: {
  copy: AdminCopy;
  items: ChangeSummaryItem[];
  title: string;
}) {
  if (items.length === 0) {
    return null;
  }

  const visibleItems = items.slice(0, 5);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="change-summary-group">
      <h4>{title}</h4>
      <ul>
        {visibleItems.map((item, index) => (
          <li key={`${item.label}-${item.detail ?? ""}-${index}`}>
            <span>{item.label}</span>
            {item.detail ? <span className="change-summary-detail">{item.detail}</span> : null}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? <p>{copy.moreChanges(hiddenCount)}</p> : null}
    </div>
  );
}

function FeaturedDishImageEditor({
  copy,
  dish,
  error,
  locale,
  onImageSelect,
  onTextUpdate,
  onUndo,
  pendingUpload,
}: {
  copy: AdminCopy;
  dish: FeaturedDish;
  error?: string;
  locale: LocaleKey;
  onImageSelect: (file: File | undefined) => void;
  onTextUpdate: (field: "name" | "alt", value: string) => void;
  onUndo: () => void;
  pendingUpload?: PendingImageUpload;
}) {
  const previewSrc = pendingUpload?.previewUrl ?? dish.image.path;
  const selectedFileName = pendingUpload?.file.name;

  return (
    <article className="featured-image-card">
      <div className="featured-image-preview">
        {previewSrc ? (
          // Blob previews from file inputs cannot use Next image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={previewSrc} />
        ) : (
          <span className="featured-image-placeholder">{copy.imagePlaceholder}</span>
        )}
      </div>
      <div className="featured-image-fields">
        <LocalizedInput
          label={copy.itemName}
          onChange={(value) => onTextUpdate("name", value)}
          value={dish.name[locale] ?? ""}
        />
        <LocalizedInput
          label={copy.imageAlt}
          onChange={(value) => onTextUpdate("alt", value)}
          value={dish.image.alt?.[locale] ?? ""}
        />
        <div className="file-upload-control">
          <div className="file-upload-picker">
            <p>{copy.uploadAvif}</p>
            <label
              className="upload-button"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onImageSelect(event.dataTransfer.files?.[0]);
              }}
            >
              <span>{copy.chooseAvif}</span>
              <input
                accept=".avif,image/avif"
                onChange={(event) => {
                  onImageSelect(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          </div>
          <div className="file-upload-selection">
            <div className="file-upload-selection-row">
              <p className="upload-file-name">
                {selectedFileName ? `${copy.selectedFile}: ${selectedFileName}` : copy.noFileSelected}
              </p>
              {pendingUpload ? (
                <button className="image-remove-selection" onClick={onUndo} type="button">
                  {copy.removeSelection}
                </button>
              ) : null}
            </div>
            {pendingUpload ? <p className="image-upload-state">{copy.pendingImage}</p> : null}
          </div>
        </div>
        {error ? (
          <p className="image-upload-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function LinkEditor({
  copy,
  links,
  onAdd,
  onRemove,
  onUpdate,
  title,
}: {
  copy: AdminCopy;
  links: CmsLink[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof CmsLink, value: string) => void;
  title: string;
}) {
  return (
    <section className="link-editor">
      <div className="admin-section-title">
        <h2>{title}</h2>
        <button className="admin-button secondary" onClick={onAdd} type="button">
          {copy.addLink}
        </button>
      </div>
      {links.map((link, index) => (
        <div className="link-row" key={`${link.label}-${index}`}>
          <PlainInput
            label={copy.label}
            onChange={(value) => onUpdate(index, "label", value)}
            value={link.label}
          />
          <PlainInput
            label={copy.url}
            onChange={(value) => onUpdate(index, "href", value)}
            value={link.href}
          />
          <button className="admin-button danger" onClick={() => onRemove(index)} type="button">
            {copy.remove}
          </button>
        </div>
      ))}
    </section>
  );
}

function LocalizedInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <PlainInput label={label} onChange={onChange} value={value} />;
}

function PlainInput({
  autoComplete,
  error,
  id,
  label,
  onBlur,
  onChange,
  type = "text",
  value,
}: {
  autoComplete?: string;
  error?: string;
  id?: string;
  label: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
  value: string;
}) {
  return (
    <label>
      {label}
      <input
        aria-describedby={error && id ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        autoComplete={autoComplete}
        id={id}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {error ? <span className="cms-field-error" id={id ? `${id}-error` : undefined} role="alert">{error}</span> : null}
    </label>
  );
}

function LocalizedTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <PlainTextarea label={label} onChange={onChange} value={value} />;
}

function PlainTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      {label}
      <textarea onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
    </label>
  );
}

function updateItemValue(
  item: MenuItem,
  field: "name" | "description" | "price" | "available",
  value: string | boolean,
  locale: LocaleKey,
): MenuItem {
  if (field === "name") {
    return {
      ...item,
      name: {
        ...item.name,
        [locale]: String(value),
      },
    };
  }

  if (field === "description") {
    return {
      ...item,
      description: {
        ...item.description,
        [locale]: String(value),
      },
    };
  }

  return {
    ...item,
    [field]: value,
  };
}

function buildImageSaveFormData(
  content: CmsDocument,
  contentSha: string | undefined,
  uploads: PendingImageUpload[],
  idempotencyKey: string,
) {
  const formData = new FormData();
  formData.set("content", JSON.stringify(content));
  formData.set("idempotencyKey", idempotencyKey);

  if (contentSha) {
    formData.set("expectedContentSha", contentSha);
  }

  formData.set(
    "imageUploads",
    JSON.stringify(
      uploads.map((upload) => ({
        dishId: upload.dishId,
        fileField: `image:${upload.dishId}`,
        path: upload.path,
        previousPath: upload.previousPath,
      })),
    ),
  );

  for (const upload of uploads) {
    formData.append(`image:${upload.dishId}`, upload.file, `${upload.dishId}.avif`);
  }

  return formData;
}

function normalizeFeaturedDishes(content: CmsDocument): FeaturedDish[] {
  const dishes = content.site.featuredDishes ?? [];

  return dishes
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((dish, index) => ({
      id: dish.id,
      name: dish.name,
      image: {
        path: dish.image.path,
        alt: dish.image.alt ?? {},
      },
      sortOrder: dish.sortOrder || index + 1,
    }));
}

function revokePendingPreviewUrls(uploads: Record<string, PendingImageUpload>) {
  for (const upload of Object.values(uploads)) {
    URL.revokeObjectURL(upload.previewUrl);
  }
}

function buildChangeSummary(
  previous: CmsDocument,
  current: CmsDocument,
  displayLocale: LocaleKey,
  copy: AdminCopy,
  enabledLocales: readonly LocaleKey[],
): ChangeSummary {
  const summary: ChangeSummary = { general: [], it: [], en: [] };
  const localizedFields: Array<keyof Pick<RestaurantInfo, "name" | "tagline" | "description">> = [
    "name",
    "tagline",
    "description",
  ];
  const localizedLabels = {
    name: copy.name,
    tagline: copy.tagline,
    description: copy.description,
  };

  for (const field of localizedFields) {
    for (const itemLocale of enabledLocales) {
      const previousValue = previous.site[field]?.[itemLocale];
      const currentValue = current.site[field]?.[itemLocale];

      if (valuesDiffer(previousValue, currentValue)) {
        pushChange(
          summary[itemLocale],
          copy.changedField(localizedLabels[field]),
          summarizeChangeDetail(previousValue, currentValue, copy),
        );
      }
    }
  }

  const globalFields: Array<{ field: ScalarSiteField; label: string }> = [
    { field: "phone", label: copy.phone },
    { field: "email", label: copy.email },
    { field: "bookingHref", label: copy.bookingLink },
    { field: "googleMapsUrl", label: copy.googleMapsUrl },
  ];

  if (valuesDiffer(previous.site.address, current.site.address)) {
    pushChange(summary.general, copy.changedField(copy.address));
  }

  for (const { field, label } of globalFields) {
    const previousValue = previous.site[field];
    const currentValue = current.site[field];

    if (valuesDiffer(previousValue, currentValue)) {
      pushChange(summary.general, copy.changedField(label), summarizeChangeDetail(previousValue, currentValue, copy));
    }
  }

  if (valuesDiffer(previous.site.orderLinks ?? [], current.site.orderLinks ?? [])) {
    pushChange(summary.general, copy.changedField(copy.orderLinks));
  }

  if (valuesDiffer(previous.site.socialLinks ?? [], current.site.socialLinks ?? [])) {
    pushChange(summary.general, copy.changedField(copy.socialLinks));
  }

  if (valuesDiffer(previous.site.featuredDishes ?? [], current.site.featuredDishes ?? [])) {
    pushChange(summary.general, copy.changedField(copy.featuredImages));
  }

  for (const currentHour of current.openingHours) {
    const previousHour = previous.openingHours.find((entry) => entry.dayKey === currentHour.dayKey);
    if (valuesDiffer(previousHour, currentHour)) {
      const day = dayLabels[displayLocale].find((entry) => entry.day === currentHour.dayKey)?.label ?? currentHour.dayKey;
      pushChange(summary.general, copy.changedField(`${copy.openingHours}: ${day}`));
    }
  }

  const previousCategories = new Map(previous.menuCategories.map((category) => [category.id, category]));

  for (const currentCategory of current.menuCategories) {
    const previousCategory = previousCategories.get(currentCategory.id);
    const categoryName = currentCategory.title[displayLocale] || currentCategory.title.it || currentCategory.id;

    if (!previousCategory) {
      pushChange(summary.general, copy.addedCategory(categoryName));
      continue;
    }

    for (const itemLocale of enabledLocales) {
      const previousTitle = previousCategory.title[itemLocale];
      const currentTitle = currentCategory.title[itemLocale];

      if (valuesDiffer(previousTitle, currentTitle)) {
        pushChange(
          summary[itemLocale],
          copy.changedCategory(currentTitle || categoryName),
          summarizeChangeDetail(previousTitle, currentTitle, copy),
        );
      }
    }

    collectItemChanges(previousCategory, currentCategory, displayLocale, copy, summary, enabledLocales);
  }

  for (const previousCategory of previous.menuCategories) {
    if (!current.menuCategories.some((category) => category.id === previousCategory.id)) {
      pushChange(summary.general, copy.removedCategory(previousCategory.title[displayLocale] || previousCategory.id));
    }
  }

  return summary;
}

function collectItemChanges(
  previousCategory: MenuCategory,
  currentCategory: MenuCategory,
  displayLocale: LocaleKey,
  copy: AdminCopy,
  summary: ChangeSummary,
  enabledLocales: readonly LocaleKey[],
) {
  const previousItems = new Map(previousCategory.items.map((item) => [item.id, item]));

  for (const currentItem of currentCategory.items) {
    const previousItem = previousItems.get(currentItem.id);
    const itemName = currentItem.name[displayLocale] || currentItem.name.it || currentItem.id;

    if (!previousItem) {
      pushChange(summary.general, copy.addedItem(itemName));
      continue;
    }

    if (valuesDiffer(previousItem.price, currentItem.price)) {
      pushChange(
        summary.general,
        copy.changedItem(itemName, copy.price),
        summarizeChangeDetail(previousItem.price, currentItem.price, copy),
      );
    }

    if (valuesDiffer(previousItem.available, currentItem.available)) {
      pushChange(summary.general, copy.changedItem(itemName, copy.available));
    }

    for (const itemLocale of enabledLocales) {
      const localizedName = currentItem.name[itemLocale] || itemName;

      const previousName = previousItem.name[itemLocale];
      const currentName = currentItem.name[itemLocale];

      if (valuesDiffer(previousName, currentName)) {
        pushChange(
          summary[itemLocale],
          copy.changedItem(localizedName, copy.itemName),
          summarizeChangeDetail(previousName, currentName, copy),
        );
      }

      const previousDescription = previousItem.description?.[itemLocale];
      const currentDescription = currentItem.description?.[itemLocale];

      if (valuesDiffer(previousDescription, currentDescription)) {
        pushChange(
          summary[itemLocale],
          copy.changedItem(localizedName, copy.description),
          summarizeChangeDetail(previousDescription, currentDescription, copy),
        );
      }
    }
  }

  for (const previousItem of previousCategory.items) {
    if (!currentCategory.items.some((item) => item.id === previousItem.id)) {
      pushChange(summary.general, copy.removedItem(previousItem.name[displayLocale] || previousItem.id));
    }
  }
}

function pushChange(items: ChangeSummaryItem[], label: string, detail?: string) {
  items.push(detail ? { label, detail } : { label });
}

function summarizeChangeDetail(previous: unknown, current: unknown, copy: AdminCopy) {
  if (typeof previous !== "string" && typeof current !== "string") {
    return undefined;
  }

  const from = formatSummaryValue(previous, copy);
  const to = formatSummaryValue(current, copy);

  if (from === to || from.length > CHANGE_DETAIL_MAX_LENGTH || to.length > CHANGE_DETAIL_MAX_LENGTH) {
    return undefined;
  }

  return copy.changeDetail(from, to);
}

function formatSummaryValue(value: unknown, copy: AdminCopy) {
  if (typeof value !== "string") {
    return copy.emptyValue;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || copy.emptyValue;
}

function valuesDiffer(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}

function formatItemCount(count: number, copy: AdminCopy) {
  return `${count} ${count === 1 ? copy.itemSingular : copy.itemPlural}`;
}

function formatRomeDateTime(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ROME_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");

  if (!year || !month) {
    return value;
  }

  return `${month}/${year}`;
}
