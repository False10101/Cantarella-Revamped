"use client"
import { ClipboardList, Clock, Database, MessagesSquare } from "lucide-react"
import { usePathname } from "next/navigation"

export default function Navbar({ status }: { status: boolean }) {
    const user = {
        initial: 'I',
        name: 'Ian',
        email: 'ian@gmail.com'
    }

    const pathname = usePathname();

    return (
        <div className="flex flex-col relative w-[280px] bg-[var(--surface)] h-full overflow-hidden border-r-[1px] border-[var(--border)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2"
                style={{
                    width: '20vw',
                    height: '200px',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(201,147,90,0.08), transparent 70%)'
                }}
            ></div>
            <div className="flex space-x-[10px] pt-[32px] px-[24px] pb-[24px] border-b-[1px] border-[var(--border)]">
                <div className="flex avatar w-[44px] h-[44px] rounded-[50%] bg-linear-135 from-[##2A1F14] to-[#3D2A18] border-[1px] border-[var(--border2)] font-[family-name:var(--font-display)] text-[clamp(9px,3vw,18px)] text-[var(--amber)] items-center justify-center">C</div>
                <div className="">
                    <div className="text-[var(--text)] font-[family-name:var(--font-display)] text-[clamp(8.5px,3vw,17px)] font-normal tracking-wide">Cantarella</div>
                    <div className=" text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(5.5px,3vw,11px)] font-normal tracking-normal">online — always watching</div>
                </div>
            </div>

            <div className="navigation-section flex flex-col w-full px-[16px] pt-[20px] pb-[8px]">
                <span className="text-[var(--text-dim)] font-[family-name:var(--font-body)] text-[clamp(5px,3vw,10px)] uppercase font-bold tracking-[0.12em] ml-[8px] mb-[6px]">navigation</span>
                <button className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/chat') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer hover:text-[] items-center `}>
                    <MessagesSquare className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/chat') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px]`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/chat') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"}`}>Chat</span>
                </button>
                <button className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/tasks') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer hover:text-[] items-center `}>
                    <ClipboardList className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/tasks') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px]`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/tasks') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"}`}>Tasks</span>
                </button>
                <button className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/reminders') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer hover:text-[] items-center `}>
                    <Clock className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/reminders') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px]`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/reminders') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"}`}>Reminders</span>
                </button>
                <button className={`flex group px-[12px] py-[9px] rounded-[8px] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/memories') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer hover:text-[] items-center `}>
                    <Database className={`w-[16px] h-[16px] text-[var(--text-secondary)] ${pathname.includes('/memories') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"} mr-[10px]`} strokeWidth={1.5} />
                    <span className={`text-[var(--text-secondary)] font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/memories') ? "opacity-100 !text-[var(--amber-soft)]" : "opacity-75 group-hover:!text-[var(--text)]"}`}>Memories</span>
                </button>
            </div>
            <div className="bottom-section mt-auto p-[16px] border-t-[1px] border-[var(--border)]">
                <span className="block text-[var(--text-dim)] font-[family-name:var(--font-body)] text-[clamp(5px,3vw,10px)] uppercase font-bold tracking-[0.12em] ml-[8px] mb-[6px]">Settings</span>

                <button className={`flex w-full group px-[12px] py-[9px] rounded-[8px] mb-[8px] ${pathname.includes('/settings') ? "bg-[var(--amber-dim)]" : "hover:bg-[var(--surface2)]"} cursor-pointer items-center`}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`mr-[10px] ${pathname.includes('/settings') ? "text-[var(--amber-soft)]" : "text-[var(--text-secondary)] opacity-75 group-hover:text-[var(--text)] group-hover:opacity-100"}`}>
                        <circle cx="8" cy="8" r="2.5" />
                        <path d="M8 1v2M8 13v2M1 8h2M13 8h2" strokeLinecap="round" />
                    </svg>
                    <span className={`font-[family-name:var(--font-body)] text-[clamp(6.5px,3vw,13px)] ${pathname.includes('/settings') ? "text-[var(--amber-soft)]" : "text-[var(--text-secondary)] opacity-75 group-hover:text-[var(--text)] group-hover:opacity-100"}`}>Settings</span>
                </button>

                <div className="flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] hover:bg-[var(--surface2)] cursor-pointer">
                    <div className="w-[30px] h-[30px] rounded-full bg-[var(--surface3)] border-[1px] border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] text-[11px] flex-shrink-0">{user.initial}</div>
                    <div>
                        <div className="text-[var(--text)] text-[13px] font-[family-name:var(--font-body)]">{user.name}</div>
                        <div className="text-[var(--text-dim)] text-[11px] font-[family-name:var(--font-body)]">{user.email}</div>
                    </div>
                </div>
            </div>
        </div>
    )
}
