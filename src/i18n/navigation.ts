import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** `Link`, `redirect`, `useRouter`… qui gèrent le préfixe de langue. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
