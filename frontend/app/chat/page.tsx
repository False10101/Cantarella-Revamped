"use client"
import { useAuth0 } from "@auth0/auth0-react"
import Navbar from "../navbar"

export default function page() {
  return (
    <div className="w-full h-screen bg-[var(--bg)]">
        <Navbar status={true}/>
    </div>
  )
}
