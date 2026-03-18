import { auth } from "express-oauth2-jwt-bearer";
import 'dotenv/config';
import { db } from "../../db";
import { users } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const JWTCheck = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_DOMAIN,
  tokenSigningAlg: process.env.TOKEN_SIGNING_ALGORITHM
})


export const attachUser = async (req: any, res: any, next: any) => {

  try {
    const googleId = req.auth.payload.sub

    if (!googleId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    let result = await db.select().from(users).where(eq(users.googleId, googleId));
    let user = result[0];

    if (!user) {

      const userInfoRes = await fetch(`${process.env.AUTH0_DOMAIN}/userinfo`, {
        headers: { Authorization: `Bearer ${req.headers.authorization?.split(' ')[1]}` }
      })
      const userInfo = await userInfoRes.json();
      
      await db.insert(users).values({
        googleId: googleId,
        name: userInfo.name || "",
        email: userInfo.email || ""
      })

      const newResult = await db.select().from(users).where(eq(users.googleId, googleId));

      user = newResult[0];
    }

    req.user = user
    next()
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Auth error' })
  }

}