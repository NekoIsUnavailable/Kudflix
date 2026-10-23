import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Upload, User } from 'lucide-react';
import {
  DEFAULT_PROFILES,
  normalizeStoredProfiles,
  type Profile,
} from '../utils/profiles';
import { ProfileImageCropModal } from './ProfileImageCropModal';
import { useProfileImageCropFlow } from '../hooks/useProfileImageCropFlow';

export type { Profile } from '../utils/profiles';
export { DEFAULT_PROFILES } from '../utils/profiles';

// All 9 Key VN avatar options
const AVATAR_OPTIONS = Array.from({ length: 9 }, (_, i) => `./avatars/key${i + 1}.jpg`);

export function ProfilesScreen({
  onSelect,
  skipProfilePicker = false,
  defaultProfileId = null,
  onProfileSettingsChange,
}: {
  onSelect: (id: string) => void;
  skipProfilePicker?: boolean;
  defaultProfileId?: string | null;
  onProfileSettingsChange?: (update: { skipProfilePicker?: boolean; defaultProfileId?: string | null }) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editingMode, setEditingMode] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const onAvatarSaved = useCallback((url: string) => {
    setEditingProfile((p) => (p ? { ...p, avatar: url } : p));
    setShowAvatarPicker(false);
  }, []);

  const { cropImageSrc, pickProfileImage, cancelCrop, applyCrop } =
    useProfileImageCropFlow(onAvatarSaved);

  useEffect(() => {
    const saved = localStorage.getItem('netflix_profiles');
    if (saved) {
      const parsed = JSON.parse(saved) as Profile[];
      const { profiles: normalized, changed } = normalizeStoredProfiles(parsed);
      if (changed) {
        localStorage.setItem('netflix_profiles', JSON.stringify(normalized));
      }
      setProfiles(normalized);
    } else {
      setProfiles(DEFAULT_PROFILES);
      localStorage.setItem('netflix_profiles', JSON.stringify(DEFAULT_PROFILES));
    }
  }, []);

  const saveProfile = (p: Profile) => {
    let updated = [...profiles];
    if (profiles.find(x => x.id === p.id)) {
      updated = updated.map(x => x.id === p.id ? p : x);
    } else {
      updated.push(p);
    }
    setProfiles(updated);
    localStorage.setItem('netflix_profiles', JSON.stringify(updated));
    setEditingProfile(null);
    setShowAvatarPicker(false);
  };

  const deleteProfile = (id: string) => {
    const updated = profiles.filter(x => x.id !== id);
    setProfiles(updated);
    localStorage.setItem('netflix_profiles', JSON.stringify(updated));
    if (defaultProfileId === id && onProfileSettingsChange) {
      onProfileSettingsChange({
        defaultProfileId: updated[0]?.id ?? null,
        skipProfilePicker: updated.length > 0 && skipProfilePicker,
      });
    }
    setEditingProfile(null);
  };

  const updateProfileSettings = (update: { skipProfilePicker?: boolean; defaultProfileId?: string | null }) => {
    onProfileSettingsChange?.(update);
  };

  // Avatar Picker Overlay
  if (editingProfile && showAvatarPicker) {
    return (
      <div className='fixed inset-0 z-[400] bg-[#141414] flex flex-col items-center justify-center animate-fade-in'>
        <h1 className='text-3xl md:text-4xl font-bold text-white mb-8 tracking-tight'>Choose Avatar</h1>
        
        <div className='grid grid-cols-3 gap-4 mb-8'>
          {AVATAR_OPTIONS.map((avatar, i) => (
            <button
              key={i}
              onClick={() => {
                setEditingProfile({ ...editingProfile, avatar });
                setShowAvatarPicker(false);
              }}
              className={`w-28 h-28 rounded-lg overflow-hidden border-4 transition-all duration-200 hover:scale-110 hover:shadow-lg hover:shadow-white/10 ${editingProfile.avatar === avatar ? 'border-white scale-105' : 'border-transparent hover:border-gray-500'}`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <img src={avatar} alt={`Avatar ${i + 1}`} className='w-full h-full object-cover' />
            </button>
          ))}
        </div>

        {/* Custom Upload */}
        <div className='mb-8'>
          <button
            type="button"
            onClick={() => pickProfileImage()}
            className='flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition'
          >
            <Upload className='w-4 h-4' /> Upload Custom Image
          </button>
        </div>

        {cropImageSrc && (
          <ProfileImageCropModal
            imageSrc={cropImageSrc}
            onCancel={cancelCrop}
            onApply={applyCrop}
          />
        )}

        <button 
          onClick={() => setShowAvatarPicker(false)}
          className='border border-gray-500 text-gray-400 px-6 py-2 rounded font-bold hover:text-white hover:border-white transition'
        >
          Back
        </button>
      </div>
    );
  }

  // Edit Profile Screen
  if (editingProfile) {
    return (
      <div className='fixed inset-0 z-[400] bg-[#141414] flex flex-col items-center justify-center animate-fade-in'>
        <h1 className='text-4xl md:text-5xl font-bold text-white mb-12 tracking-tight'>Edit Profile</h1>
        <div className='flex flex-col md:flex-row items-start gap-8'>
          <button 
            onClick={() => setShowAvatarPicker(true)}
            className='w-32 h-32 md:w-40 md:h-40 rounded bg-gray-800 overflow-hidden border-4 border-transparent hover:border-white transition-all duration-300 group relative cursor-pointer'
            style={{ backgroundColor: editingProfile.color }}
          >
            <img src={editingProfile.avatar} alt={editingProfile.name} className='w-full h-full object-cover' />
            <div className='absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
              <Edit2 className='w-8 h-8 text-white' />
            </div>
          </button>
          <div className='flex flex-col gap-4'>
            <input 
              type="text" 
              value={editingProfile.name}
              onChange={e => setEditingProfile({ ...editingProfile, name: e.target.value })}
              className='bg-gray-600 text-white px-4 py-2 text-xl font-semibold outline-none focus:ring-2 focus:ring-white rounded'
              placeholder="Name"
            />

            <div className='flex items-center gap-2 mt-2'>
              <span className='text-sm text-gray-400 font-semibold'>Color Banner</span>
              <input 
                type="color" 
                value={editingProfile.color}
                onChange={e => setEditingProfile({ ...editingProfile, color: e.target.value })}
                className='w-8 h-8 rounded cursor-pointer border-none bg-transparent'
              />
            </div>
          </div>
        </div>
        <div className='flex gap-4 mt-12'>
          <button 
            onClick={() => saveProfile(editingProfile)}
            className='bg-white text-black px-6 py-2 rounded font-bold hover:bg-gray-200 transition-all duration-200 hover:scale-105 active:scale-95 text-xl'
          >
            Save
          </button>
          <button 
            onClick={() => { setEditingProfile(null); setShowAvatarPicker(false); }}
            className='border border-gray-500 text-gray-400 px-6 py-2 rounded font-bold hover:text-white hover:border-white transition text-xl'
          >
            Cancel
          </button>
          {profiles.find(x => x.id === editingProfile.id) && profiles.length > 1 && (
            <button 
              onClick={() => deleteProfile(editingProfile.id)}
              className='border border-gray-500 text-gray-400 px-6 py-2 rounded font-bold hover:text-red-500 hover:border-red-500 transition text-xl'
            >
              Delete Profile
            </button>
          )}
        </div>
      </div>
    );
  }

  // Who's Watching Screen
  return (
    <div className='fixed inset-0 z-[400] bg-[#141414] flex flex-col items-center justify-center animate-fade-in'>
      <h1 className='text-4xl md:text-5xl font-bold text-white mb-12 tracking-tight animate-slide-down'>
        {editingMode ? 'Manage Profiles' : "Who's watching?"}
      </h1>
      
      {editingMode && onProfileSettingsChange && (
        <div
          className="flex items-center gap-3 mb-8 max-w-md w-full mx-4 bg-gray-800/40 p-4 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-800/60 transition"
          onClick={() => {
            const next = !skipProfilePicker;
            let nextDefault = defaultProfileId;
            if (next && !nextDefault && profiles.length > 0) nextDefault = profiles[0].id;
            updateProfileSettings({ skipProfilePicker: next, defaultProfileId: nextDefault });
          }}
        >
          <User className="w-5 h-5 text-accent flex-shrink-0" />
          <div className="flex-grow min-w-0">
            <span className="text-sm font-bold text-white block">Skip profile selection on startup</span>
            <span className="text-xs text-gray-400">Select a profile below as the default to automatically be logged into on launch</span>
          </div>
          <input
            type="checkbox"
            checked={skipProfilePicker}
            onChange={(e) => {
              const next = e.target.checked;
              let nextDefault = defaultProfileId;
              if (next && !nextDefault && profiles.length > 0) nextDefault = profiles[0].id;
              updateProfileSettings({ skipProfilePicker: next, defaultProfileId: nextDefault });
            }}
            className="w-5 h-5 accent-accent flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className='flex gap-8 flex-wrap justify-center items-start'>
        {profiles.map((p, i) => (
          <div 
            key={p.id} 
            className='group flex flex-col items-center cursor-pointer relative animate-scale-in'
            style={{ animationDelay: `${i * 100}ms` }}
            onClick={() => {
              if (editingMode) setEditingProfile(p);
              else onSelect(p.id);
            }}
          >
            <div 
              className={`w-32 h-32 md:w-40 md:h-40 rounded bg-gray-800 border-4 transition-all duration-300 overflow-hidden relative ${
                editingMode
                  ? defaultProfileId === p.id && skipProfilePicker
                    ? 'border-accent opacity-100 scale-105'
                    : 'border-transparent opacity-50'
                  : 'border-transparent group-hover:border-white group-hover:scale-105'
              }`}
              style={{ backgroundColor: p.color }}
            >
              <img src={p.avatar} alt={p.name} className='w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity' />
              {editingMode && (
                <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                  <Edit2 className='w-10 h-10 text-white' />
                </div>
              )}
            </div>
            <span className={`mt-4 text-gray-400 ${!editingMode && 'group-hover:text-white'} transition font-semibold`}>{p.name}</span>
            {editingMode && skipProfilePicker && onProfileSettingsChange && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateProfileSettings({ defaultProfileId: p.id, skipProfilePicker: true });
                }}
                className={`mt-2 text-xs font-bold px-3 py-1 rounded transition ${defaultProfileId === p.id ? 'bg-accent text-white' : 'bg-gray-700 text-gray-300 hover:text-white'}`}
              >
                {defaultProfileId === p.id ? 'Default' : 'Set default'}
              </button>
            )}
          </div>
        ))}

        <div 
          className='group flex flex-col items-center cursor-pointer animate-scale-in'
          style={{ animationDelay: `${profiles.length * 100}ms` }}
          onClick={() => {
            setEditingProfile({
              id: Date.now().toString(),
              name: 'New Profile',
              color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
              avatar: AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)]
            });
          }}
        >
          <div className='w-32 h-32 md:w-40 md:h-40 rounded border-2 border-gray-600 flex items-center justify-center group-hover:bg-gray-800 group-hover:text-white group-hover:scale-105 text-gray-600 transition-all duration-300'>
            <Plus className='w-16 h-16' />
          </div>
          <span className='mt-4 text-gray-400 group-hover:text-white transition font-semibold'>Add Profile</span>
        </div>
      </div>
      
      <button 
        onClick={() => setEditingMode(!editingMode)}
        className='mt-16 border border-gray-500 text-gray-400 px-6 py-2 rounded text-xl hover:text-white hover:border-white transition-all duration-200 hover:scale-105 active:scale-95'
      >
        {editingMode ? 'Done' : 'Manage Profiles'}
      </button>
    </div>
  );
}
