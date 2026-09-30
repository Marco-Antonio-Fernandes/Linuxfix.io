# Fix.io Linux · Local Agent

Este diretório reserva o agente que futuramente executará operações da bancada no Linux.

O diretório `local-agent` original contém somente artefatos `bin/` e `obj/` de uma compilação Windows do `Fixio.BenchAgent`; não há código-fonte portável disponível neste checkout para copiar ou compilar no Linux.

Portanto, o cliente Linux não depende deste agente nesta etapa. A futura migração deve preservar o protocolo usado pelo sistema de gerenciamento e substituir as partes específicas de Windows por processos e ferramentas Linux, preferencialmente atrás de uma interface comum.
