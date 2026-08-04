"use client"
import { useAuth0 } from "@auth0/auth0-react"
import { ClipboardList, Clock, Database, LogOut, MessagesSquare } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Navbar() {
    const { logout } = useAuth0();
    const pathname = usePathname();

    return (
        <div className="flex flex-col relative w-[260px] max-[820px]:w-[76px] bg-[var(--surface)] h-full overflow-hidden border-r-[1px] border-[var(--border)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2"
                style={{
                    width: '20vw',
                    height: '200px',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(201,147,90,0.08), transparent 70%)'
                }}
            ></div>
            <div className="flex space-x-[10px] pt-[32px] px-[24px] pb-[24px] border-b-[1px] border-[var(--border)] max-[820px]:justify-center max-[820px]:px-0">
                <div className="flex avatar w-[44px] h-[44px] rounded-[50%] bg-linear-135 from-[#2A1F14] to-[#3D2A18] border-[1px] border-[var(--border2)] font-[family-name:var(--font-display)] text-[clamp(9px,3vw,18px)] text-[var(--amber)] items-center justify-center">C</div>
                <div className="max-[820px]:hidden">
                    <div className="text-[var(--text)] font-[family-name:var(--font-display)] text-[clamp(8.5px,3vw,17px)] font-normal tracking-wide">Cantarella</div>
                    <div className=" text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(5.5px,3vw,11px)] font-normal tracking-normal">online — always watching</div>
                </div>
            </div>

            <div className="navigation-section flex flex-col w-full px-[16px] pt-[20px] pb-[8px]">
                <span className="text-[var(--text-dim)] font-[family-name:var(--font-body)] text-[clamp(5px,3vw,10px)] uppercase font-bold tracking-[0.12em] ml-[8px] mb-[6px] max-[820px]:hidden">navigation</span>
                <Link href="/chat" aria-label="Chat" className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/chat') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer items-center max-[820px]:justify-center`}>
                    <MessagesSquare className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/chat') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px] max-[820px]:mr-0`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/chat') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} max-[820px]:hidden`}>Chat</span>
                </Link>
                <button disabled aria-disabled="true" title="Tasks — coming soon" className="flex cursor-not-allowed items-center rounded-[8px] px-[12px] py-[9px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] opacity-55 max-[820px]:justify-center">
                    <ClipboardList className="mr-[10px] h-[16px] w-[16px] text-[var(--text-secondary)] opacity-75 max-[820px]:mr-0" strokeWidth={1.5} />
                    <span className="text-[var(--text-secondary)] opacity-75 max-[820px]:hidden">Tasks</span>
                    <span className="ml-auto rounded-full border border-[rgba(201,147,90,0.18)] bg-[var(--amber-dim)] px-1.5 py-0.5 text-[8px] uppercase tracking-[0.08em] text-[var(--amber-soft)] max-[820px]:hidden">
                        Coming soon
                    </span>
                </button>
                <Link href="/reminders" aria-label="Reminders" className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/reminders') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer items-center max-[820px]:justify-center`}>
                    <Clock className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/reminders') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px] max-[820px]:mr-0`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/reminders') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} max-[820px]:hidden`}>Reminders</span>
                </Link>
                <Link href="/memories" aria-label="Memories" className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/memories') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer items-center max-[820px]:justify-center`}>
                    <Database className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/memories') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px] max-[820px]:mr-0`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/memories') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} max-[820px]:hidden`}>Memories</span>
                </Link>
            </div>
            <div className="bottom-section mt-auto p-[16px] border-t-[1px] border-[var(--border)] max-[820px]:p-2">
                <span className="block text-[var(--text-dim)] font-[family-name:var(--font-body)] text-[clamp(5px,3vw,10px)] uppercase font-bold tracking-[0.12em] ml-[8px] mb-[6px] max-[820px]:hidden">Settings</span>

                <Link href="/settings" aria-label="Settings" className={`flex w-full group px-[12px] py-[9px] rounded-[8px] mb-[8px] ${pathname.includes('/settings') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer items-center max-[820px]:justify-center`}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`mr-[10px] max-[820px]:mr-0 ${pathname.includes('/settings') ? "text-[var(--amber-soft)]" : "text-[var(--text-secondary)] opacity-75 group-hover:text-[var(--text)] group-hover:opacity-100"}`}>
                        <circle cx="8" cy="8" r="2.5" />
                        <path d="M8 1v2M8 13v2M1 8h2M13 8h2" strokeLinecap="round" />
                    </svg>
                    <span className={`font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/settings') ? "text-[var(--amber-soft)]" : "text-[var(--text-secondary)] opacity-75 group-hover:text-[var(--text)] group-hover:opacity-100"} max-[820px]:hidden`}>Settings</span>
                </Link>

                <button
                    type="button"
                    onClick={() => logout({
                        logoutParams: {
                            returnTo: `${window.location.origin}/auth/login`,
                        },
                    })}
                    className="group flex w-full cursor-pointer items-center rounded-[8px] px-[12px] py-[9px] hover:bg-[var(--surface2)] max-[820px]:justify-center"
                    aria-label="Log out"
                    title="Log out"
                >
                    <LogOut className="mr-[10px] h-[16px] w-[16px] text-[var(--text-secondary)] opacity-75 transition group-hover:text-[var(--text)] group-hover:opacity-100 max-[820px]:mr-0" strokeWidth={1.5} />
                    <span className="font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] text-[var(--text-secondary)] opacity-75 transition group-hover:text-[var(--text)] group-hover:opacity-100 max-[820px]:hidden">
                        Log out
                    </span>
                </button>
            </div>
        </div>
    )
}
