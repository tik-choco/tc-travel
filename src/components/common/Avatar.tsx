// Shared identity element (docs/REDESIGN.md's Avatar identity section) —
// image-first via useMemberAvatarUrl, emoji fallback otherwise. Everyone
// rendering a person (self or a room member) should use this instead of
// reading avatarEmoji directly.
import { useMemberAvatarUrl } from "../../lib/avatar";
import { useProfile } from "../../lib/personal";
import type { Member } from "../../lib/types";

const SIZE_CLASS: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "avatar-sm",
  md: "",
  lg: "avatar-lg",
  xl: "avatar-xl",
};

const FALLBACK_EMOJI = "\u{1F9ED}"; // compass — matches collab.ts's FALLBACK_EMOJI

export function Avatar(props: {
  /** Renders this member's image (via useMemberAvatarUrl) or emoji. Ignored when `self` is set. */
  member?: Member | null;
  /** Renders the local profile's avatarImage/emoji instead of `member`. */
  self?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  /** Member color ring; omitted for a plain outline. */
  ringColor?: string;
}) {
  const { member, self, size = "md", ringColor } = props;
  const [profile] = useProfile();
  // Hooks must run unconditionally regardless of the self/member branch below.
  const remoteUrl = useMemberAvatarUrl(self ? null : (member ?? null));

  const url = self ? (profile.avatarImage ?? null) : remoteUrl;
  // Self must always have a visible glyph too: an older/edited profile can carry
  // an empty avatarEmoji, which would otherwise render a blank circle (members
  // already fall back, self didn't).
  const emoji = self ? (profile.avatarEmoji || FALLBACK_EMOJI) : (member?.avatarEmoji ?? FALLBACK_EMOJI);
  const sizeClass = SIZE_CLASS[size];
  const style = ringColor ? { borderColor: ringColor } : undefined;

  return (
    <span class={sizeClass ? `avatar ${sizeClass}` : "avatar"} style={style}>
      {url ? <img class="avatar-img" src={url} alt="" /> : emoji}
    </span>
  );
}
