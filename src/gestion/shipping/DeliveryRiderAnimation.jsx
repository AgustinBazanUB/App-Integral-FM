import { useCallback, useEffect, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export default function DeliveryRiderAnimation({ playing, speed = 1 }) {
  const [player, setPlayer] = useState(null);
  const receivePlayer = useCallback(instance => setPlayer(instance), []);

  useEffect(() => {
    if (!player) return;
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  return <DotLottieReact
    src="/animations/flor-mia-delivery-rider.lottie"
    animationId="rider"
    autoplay={playing}
    loop
    speed={speed}
    useFrameInterpolation
    dotLottieRefCallback={receivePlayer}
    style={{ width: "100%", height: "100%", display: "block" }}
    aria-hidden="true"
  />;
}
