# Buscaminas AR

Juego de Realidad Aumentada inspirado en el clásico Buscaminas.

## Objetivo
Colocar un tablero 5×5 sobre una superficie real, descubrir todas las casillas seguras y evitar las 4 minas.

## Mecánicas
- Tablero 5×5 generado aleatoriamente.
- 4 minas por partida.
- Números de proximidad.
- Modo descubrir y modo bandera.
- 3 vidas.
- Cronómetro.
- Victoria al revelar todas las casillas seguras.
- Derrota al perder las tres vidas.
- Reinicio de partida.

## Realidad aumentada
La versión principal utiliza WebXR Hit Test para detectar superficies y colocar el tablero sobre una mesa o el piso.

Incluye un modo de prueba para navegadores que no soporten WebXR AR.

## Tecnologías
- HTML / CSS / JavaScript
- Three.js
- WebXR
- Hit Test
- Vercel

## Controles
1. Inicia la experiencia.
2. Mueve el teléfono hasta detectar una superficie.
3. Toca para colocar el tablero.
4. Usa "Descubrir" para abrir casillas.
5. Usa "Bandera" para marcar minas sospechosas.
