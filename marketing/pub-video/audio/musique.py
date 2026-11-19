import numpy as np, wave
import sys
sr=44100; D=float(sys.argv[1]) if len(sys.argv)>1 else 32; t=np.arange(int(sr*D))/sr; out=np.zeros_like(t)
f=lambda n:440*2**((n-69)/12)
chords=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]  # Am F C G
bass=[45,41,36,43]
for k in range(16):
    s=k*2.0; idx=(t>=s)&(t<s+2.4); tt=t[idx]-s
    env=np.minimum(1,tt/0.15)*np.exp(-tt*0.6)
    c=chords[k%4]
    for n in c: out[idx]+=0.06*env*(np.sin(2*np.pi*f(n)*tt)+0.3*np.sin(4*np.pi*f(n)*tt))
    out[idx]+=0.12*env*np.sin(2*np.pi*f(bass[k%4])*tt)
# arpeggio 8th notes from 4s
for k in range(int(4/0.25),int(31/0.25)):
    s=k*0.25; c=chords[int(s//2)%4]; n=c[k%3]+12
    idx=(t>=s)&(t<s+0.3); tt=t[idx]-s
    out[idx]+=0.035*np.exp(-tt*9)*np.sin(2*np.pi*f(n)*tt)
# soft kick each beat 4s-27s
for k in range(8,54):
    s=k*0.5; idx=(t>=s)&(t<s+0.25); tt=t[idx]-s
    out[idx]+=0.25*np.exp(-tt*18)*np.sin(2*np.pi*(50+90*np.exp(-tt*30))*tt)
fade=np.minimum(1,np.minimum(t/0.8,(D-t)/2.5)); out*=fade
out/=np.abs(out).max()*1.12
st=np.stack([out,out],1); w=wave.open(sys.argv[2] if len(sys.argv)>2 else 'musique.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
