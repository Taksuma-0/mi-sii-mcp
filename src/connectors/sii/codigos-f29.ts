/**
 * Catálogo de códigos del F29 que el lector del PDF compacto reconoce fuera de la tabla (por ejemplo, el pie) y en
 * páginas sin cabecera; bajo la cabecera de la tabla se lee toda celda con valor. Incluye los vistos en F29 reales.
 * El código "1" se excluye a propósito: se confunde con números de página.
 */
export const CODIGOS_F29: ReadonlySet<string> = new Set(
  (
    '15 28 32 39 48 49 50 54 56 62 66 70 73 77 89 91 92 93 94 100 101 102 103 104 110 113 115 126 130 146 150 151 152 153 154 ' +
    '155 156 157 160 164 409 500 502 503 504 507 508 509 510 511 512 513 515 516 518 519 520 522 523 524 526 527 528 529 530 ' +
    '531 532 533 534 536 537 538 539 540 541 543 544 545 546 547 548 549 551 552 554 555 556 557 558 559 562 563 564 565 566 ' +
    '572 573 574 575 577 580 582 584 585 586 588 589 591 592 593 594 595 597 602 603 700 704 707 708 710 712 713 714 716 718 ' +
    '720 721 725 728 729 730 731 733 736 738 743 745 750 751 752 753 755 757 758 760 761 763 765 766 767 768 771 772 777 779 ' +
    '782 784 786 788 790 791 795 806 ' +
    '811 812 813 814 815 816 817 922'
  ).split(' '),
);
