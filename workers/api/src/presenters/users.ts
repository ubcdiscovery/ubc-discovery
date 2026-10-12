import type { User } from '../db/schema';
import type { ObjectStorage } from '../services/storage';

export function presentUser(user: User, storage?: ObjectStorage) {
  return {
    id: user.id,
    email: user.email,
    preferred_name: user.preferredName,
    major: user.major,
    academic_level: user.academicLevel,
    faculty_id: user.facultyId,
    interests: user.interests,
    bio: user.bio,
    profile_picture_url: storage && user.profilePictureKey ? storage.publicUrl(user.profilePictureKey) : null,
    is_admin: user.isAdmin,
    ubc_verified: user.ubcVerified,
    created_at: user.createdAt.toISOString(),
  };
}
