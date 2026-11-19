import React from 'react';
import {Composition} from 'remotion';
import {Pub} from './Pub';
export const Root: React.FC = () => (
  <>
    <Composition id="PubH" component={Pub} durationInFrames={960} fps={30} width={1920} height={1080} />
    <Composition id="PubV" component={Pub} durationInFrames={960} fps={30} width={1080} height={1920} />
    <Composition id="Pub45" component={Pub} durationInFrames={960} fps={30} width={1080} height={1350} />
  </>
);
