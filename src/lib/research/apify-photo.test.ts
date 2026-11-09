import { describe, expect, it, vi } from "vitest";
import { allowedPhotoUrl, apifyPhotoProvider, parsePhotoUrl } from "./apify-photo";

const CDN = "https://media.licdn.com/dms/image/v2/x/profile-displayphoto-shrink_";

describe("photo url", () => {
  it("only accepts https links on LinkedIn's image host", () => {
    expect(allowedPhotoUrl(`${CDN}800_800/a.jpg`)).toBeTruthy();
    expect(allowedPhotoUrl("http://media.licdn.com/a.jpg")).toBeNull();
    expect(allowedPhotoUrl("https://evil.example.com/a.jpg")).toBeNull();
    expect(allowedPhotoUrl("https://licdn.com.evil.example/a.jpg")).toBeNull();
    expect(allowedPhotoUrl("http://169.254.169.254/latest")).toBeNull();
    expect(allowedPhotoUrl(null)).toBeNull();
  });

  it("prefers the smallest rendition that is at least card sized, else the main photo", () => {
    const sizes = [{ url: `${CDN}100_100/s.jpg`, width: 100 }, { url: `${CDN}400_400/m.jpg`, width: 400 }, { url: `${CDN}800_800/l.jpg`, width: 800 }];
    expect(parsePhotoUrl([{ photo: `${CDN}800_800/l.jpg`, profilePicture: { url: `${CDN}800_800/l.jpg`, sizes } }])).toContain("/m.jpg");
    expect(parsePhotoUrl([{ photo: `${CDN}800_800/l.jpg` }])).toContain("/l.jpg");
    expect(parsePhotoUrl([{ photo: "https://evil.example.com/a.jpg", profilePicture: null }])).toBeNull();
    expect(parsePhotoUrl([{ photo: null, profilePicture: null }])).toBeNull();
    expect(parsePhotoUrl("nope")).toBeNull();
  });
});

describe("apifyPhotoProvider", () => {
  const profileUrl = "https://www.linkedin.com/in/someone";
  const actor = (body: unknown) => new Response(JSON.stringify(body), { status: 201 });
  const image = (type = "image/jpeg", bytes = 10) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } });

  it("runs the profile actor and downloads the picture", async () => {
    const fetchImpl = vi.fn(async (url: string) => (String(url).includes("api.apify.com") ? actor([{ photo: `${CDN}800_800/l.jpg` }]) : image()));
    const photo = await apifyPhotoProvider("tok", fetchImpl as never).fetchPhoto(profileUrl);
    expect(photo?.contentType).toBe("image/jpeg");
    expect(photo?.data.length).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when the profile has no picture, without downloading anything", async () => {
    const fetchImpl = vi.fn(async () => actor([{ photo: null, profilePicture: null }]));
    expect(await apifyPhotoProvider("tok", fetchImpl as never).fetchPhoto(profileUrl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that is not a supported image, or is too large", async () => {
    const html = vi.fn(async (url: string) => (String(url).includes("api.apify.com") ? actor([{ photo: `${CDN}800_800/l.jpg` }]) : image("text/html")));
    await expect(apifyPhotoProvider("tok", html as never).fetchPhoto(profileUrl)).rejects.toThrow(/supported image/);
    const big = vi.fn(async (url: string) => (String(url).includes("api.apify.com") ? actor([{ photo: `${CDN}800_800/l.jpg` }]) : image("image/png", 500_000)));
    await expect(apifyPhotoProvider("tok", big as never).fetchPhoto(profileUrl)).rejects.toThrow(/too large/);
  });

  it("needs a token", () => {
    expect(() => apifyPhotoProvider("")).toThrow(/APIFY_TOKEN/);
  });
});
