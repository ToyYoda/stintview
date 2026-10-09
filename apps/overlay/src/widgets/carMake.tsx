import {
  siAcura, siAmg, siAstonmartin, siAudi, siBmw, siCadillac, siChevrolet, siFerrari, siFord, siHonda, siHyundai, siKia,
  siLamborghini, siMazda, siMclaren, siMini, siNissan, siOpel, siPeugeot, siPorsche, siRenault, siSeat, siSkoda, siSubaru,
  siToyota, siVolkswagen, siVolvo,
} from 'simple-icons';

/** Emblem paths: Simple Icons (CC0, one colour, 24×24). Brands it has no icon for get a short text. */
type Icon = { path: string };

/** Make from iRacing's car name, tried in order (first word(s) of CarScreenName). */
const MAKES: { re: RegExp; name: string; icon?: Icon }[] = [
  { re: /^porsche/i, name: 'Porsche', icon: siPorsche },
  { re: /^bmw/i, name: 'BMW', icon: siBmw },
  // Simple Icons has no Mercedes star; all of iRacing's Mercedes are AMG.
  { re: /^mercedes/i, name: 'Mercedes-AMG', icon: siAmg },
  { re: /^audi/i, name: 'Audi', icon: siAudi },
  { re: /^ferrari/i, name: 'Ferrari', icon: siFerrari },
  { re: /^lamborghini/i, name: 'Lamborghini', icon: siLamborghini },
  { re: /^mclaren/i, name: 'McLaren', icon: siMclaren },
  { re: /^ford/i, name: 'Ford', icon: siFord },
  { re: /^chevrolet/i, name: 'Chevrolet', icon: siChevrolet },
  { re: /^aston martin/i, name: 'Aston Martin', icon: siAstonmartin },
  { re: /^acura/i, name: 'Acura', icon: siAcura },
  { re: /^cadillac/i, name: 'Cadillac', icon: siCadillac },
  { re: /^toyota/i, name: 'Toyota', icon: siToyota },
  { re: /^(global )?mazda/i, name: 'Mazda', icon: siMazda },
  { re: /^hyundai/i, name: 'Hyundai', icon: siHyundai },
  { re: /^honda/i, name: 'Honda', icon: siHonda },
  { re: /^nissan/i, name: 'Nissan', icon: siNissan },
  { re: /^renault/i, name: 'Renault', icon: siRenault },
  { re: /^(vw|volkswagen)/i, name: 'Volkswagen', icon: siVolkswagen },
  { re: /^kia/i, name: 'Kia', icon: siKia },
  { re: /^subaru/i, name: 'Subaru', icon: siSubaru },
  { re: /^peugeot/i, name: 'Peugeot', icon: siPeugeot },
  { re: /^mini/i, name: 'Mini', icon: siMini },
  { re: /^skoda/i, name: 'Škoda', icon: siSkoda },
  { re: /^volvo/i, name: 'Volvo', icon: siVolvo },
  { re: /^opel/i, name: 'Opel', icon: siOpel },
  { re: /^(seat|cupra)/i, name: 'Seat', icon: siSeat },
];

/** Make of an iRacing car name: emblem if known, otherwise the first word as a short text. */
export function carMake(car: string): { name: string; icon: Icon | null; short: string } {
  const m = MAKES.find((x) => x.re.test(car.trim()));
  if (m) return { name: m.name, icon: m.icon ?? null, short: m.name.slice(0, 3).toUpperCase() };
  const first = car.trim().split(/[\s-]+/)[0] ?? '';
  return { name: first, icon: null, short: first.slice(0, 3).toUpperCase() };
}

/** Emblem (in the text colour) or a short name, with the full car name as tooltip. */
export function CarMake({ car }: { car: string }) {
  const make = carMake(car);
  if (!make.short) return null;
  return make.icon ? (
    <svg className="car-make" viewBox="0 0 24 24" role="img" aria-label={make.name}>
      <title>{car}</title>
      <path d={make.icon.path} fill="currentColor" />
    </svg>
  ) : (
    <span className="car-make-text" title={car}>{make.short}</span>
  );
}
