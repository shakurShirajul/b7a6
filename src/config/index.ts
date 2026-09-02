import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
    port : process.env.PORT,
    database_url : process.env.DATABASE_URL,
    app_url : process.env.APP_URL,
    bcrypt_salt_rounds : process.env.BCRYPT_SALT_ROUNDS,
    jwt_access_secret : process.env.JWT_ACCESS_TOKEN_SECRET!,
    jwt_refresh_secret : process.env.JWT_REFRESH_TOKEN_SECRET!,
    jwt_access_expires_in : process.env.JWT_ACCESS_TOKEN_EXPIRATION!,
    jwt_refresh_expires_in : process.env.JWT_REFRESH_TOKEN_EXPIRATION!,
}
