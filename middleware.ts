import type {Request, Response, NextFunction} from 'express';
import { createSupabaseClient } from './client';



const client = createSupabaseClient();

export async function middleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization

    const data = await client.auth.getUser(token as string) //not sure if "as string" is correct here, but it works for now
    const userId = data.data.user?.id  //reports say we're not entirely sure here either

    if (userId) {
        try {
            console.log({
                id: data.data.user!.id,
                supabaseId: data.data.user!.id,
                email: data.data.user?.email!,
                provider: data.data.user?.app_metadata.provider === "google" ? "Google" : "Github",
                name: data.data.user?.user_metadata.full_name,
            })
            
            await prisma.user.create({
                data: {
                    id: data.data.user!.id,
                    supabaseId: data.data.user!.id,
                    email: data.data.user?.email!,
                    provider: data.data.user?.app_metadata.provider === "google" ? "Google" : "Github",
                    name: data.data.user?.user_metadata.full_name,
                }
            })

            } catch (e) { console.log(e) }

        req.userId = userId;
        next();
        
    } else {
        res.status(403).json({ 
            error: "Unauthorized",
            Message: 'Incorrect credentials' 
        });
    }
}

