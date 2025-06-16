import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { createError } from '../utils/error';

export class UsersController {
    async searchUsers(req: Request, res: Response, next: NextFunction) {
        try {
            const { query } = req.body;

            if (!query || typeof query !== 'string') {
                return res.status(400).json({
                    error: 'Invalid request',
                    message: 'Search query is required'
                });
            }

            // Search for users where username or name matches the query
            const users = await User.find({
                $or: [
                    { username: { $regex: query, $options: 'i' } },
                    { 'name.first': { $regex: query, $options: 'i' } },
                    { 'name.last': { $regex: query, $options: 'i' } }
                ]
            })
            .select('username name avatar email description')
            .limit(5);

            return res.json({
                data: users
            });
        } catch (error: any) {
            console.error('Error in searchUsers:', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                error: 'Server error',
                message: `Error searching users: ${error.message}`
            });
        }
    }
}

export default new UsersController(); 