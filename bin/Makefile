include ../defines.mk

PERL_DOC_INC_DIRS=..
-include /usr/share/pve-doc-generator/pve-doc-generator.mk

SERVICES = pvestatd pveproxy pvedaemon spiceproxy pvescheduler
CLITOOLS = \
	vzdump \
	pvesubscription \
	pveceph \
	pveam \
	pvesr \
	pvenode \
	pvesh \
	pve8to9 \

LIBEXECCLITOOLS = \
	pve-network-interface-pinning \


SCRIPTS =  			\
	$(SERVICES)		\
	$(CLITOOLS)		\
	pvebanner		\
	pveversion		\
	pveupgrade		\
	pveupdate		\
	pveperf			\
	pvereport

HELPERS =			\
	pve-startall-delay	\
	pve-init-ceph-crash	\
	pve-firewall-commit	\
	pve-sdn-commit

MIGRATIONS =			\
	pve-lvm-disable-autoactivation		\
	pve-rbd-storage-configure-keyring

SERVICE_MANS = $(addsuffix .8, $(SERVICES))

CLI_MANS = 				\
	$(addsuffix .1, $(CLITOOLS))	\
	$(addsuffix .1, $(LIBEXECCLITOOLS))	\
	pveversion.1			\
	pveupgrade.1			\
	pveperf.1			\
	pvereport.1			\

BASH_COMPLETIONS = 						\
	$(addsuffix .service-bash-completion, $(SERVICES)) 	\
	$(addsuffix .bash-completion, $(CLITOOLS)) 		\
	$(addsuffix .bash-completion, $(LIBEXECCLITOOLS)) 		\

ZSH_COMPLETIONS =						\
	$(addsuffix .service-zsh-completion, $(SERVICES)) 	\
	$(addsuffix .zsh-completion, $(CLITOOLS))		\
	$(addsuffix .zsh-completion, $(LIBEXECCLITOOLS))		\

all: $(SERVICE_MANS) $(CLI_MANS)

%.1: %.1.pod
	rm -f $@
	cat $<|pod2man -n $* -s 1 -r $(VERSION) -c"Proxmox Documentation" - >$@.tmp
	mv $@.tmp $@

%.1.pod:
	podselect $* > $@.tmp
	mv $@.tmp $@

pve-network-interface-pinning.1:
	printf "pve-network-interface-pinning" > $@.tmp
	printf ".TH PVE-NETWORK-INTERFACE-PINNING 1\n.SH NAME\npve-network-interface-pinning \- Assisted interface name pinning.\n" > $@.tmp
	printf ".SH DESCRIPTION\nThis tool helps you to configure a network interface name pinning \
	 and adapting all relevant Proxmox VE config files.\n" >> $@.tmp
	mv $@.tmp $@

pve-network-interface-pinning.api-verified:
	perl ${PERL_DOC_INC} -T -e "use PVE::CLI::pve_network_interface_pinning; PVE::CLI::pve_network_interface_pinning->verify_api();"
	touch 'pve-network-interface-pinning.service-api-verified'

pve-network-interface-pinning.zsh-completion:
	perl ${PERL_DOC_INC} -T -e "use PVE::CLI::pve_network_interface_pinning; PVE::CLI::pve_network_interface_pinning->generate_zsh_completions();" >$@.tmp
	mv $@.tmp $@

pve-network-interface-pinning.bash-completion:
	perl ${PERL_DOC_INC} -T -e "use PVE::CLI::pve_network_interface_pinning; PVE::CLI::pve_network_interface_pinning->generate_bash_completions();" >$@.tmp
	mv $@.tmp $@

pve8to9.1:
	printf ".TH PVE8TO9 1\n.SH NAME\npve8to9 \- Proxmox VE upgrade checker script for 8.4+ to current 9.x\n" > $@.tmp
	printf ".SH DESCRIPTION\nThis tool will help you to detect common pitfalls and misconfguration\
	 before, and during the upgrade of a Proxmox VE system\n" >> $@.tmp
	printf "Any failure must be addressed before the upgrade, and any warning must be addressed, \
	 or at least carefully evaluated, if a false-positive is suspected\n" >> $@.tmp
	printf ".SH SYNOPSIS\npve8to9 [--full]\n" >> $@.tmp
	mv $@.tmp $@


pveversion.1.pod: pveversion
pveupgrade.1.pod: pveupgrade
pvereport.1.pod: pvereport

.PHONY: tidy
tidy:
	echo $(SCRIPTS) $(HELPERS) $(MIGRATIONS) $(LIBEXECCLITOOLS) | xargs -n4 -P0 proxmox-perltidy

.PHONY: check
check: $(addsuffix .service-api-verified, $(SERVICES)) $(addsuffix .api-verified, $(CLITOOLS)) $(addsuffix .api-verified, $(LIBEXECCLITOOLS))
	rm -f *.service-api-verified *.api-verified

.PHONY: install
install: $(SCRIPTS) $(LIBEXECCLITOOLS) $(CLI_MANS) $(SERVICE_MANS) $(BASH_COMPLETIONS) $(ZSH_COMPLETIONS)
	install -d $(BINDIR)
	install -m 0755 $(SCRIPTS) $(BINDIR)
	install -d $(LIBEXECDIR)
	install -m 0755 $(LIBEXECCLITOOLS) $(LIBEXECDIR)
	install -d $(USRSHARE)/helpers
	install -m 0755 $(HELPERS) $(USRSHARE)/helpers
	install -d $(USRSHARE)/migrations
	install -m 0755 $(MIGRATIONS) $(USRSHARE)/migrations
	install -d $(MAN1DIR)
	install -m 0644 $(CLI_MANS) $(MAN1DIR)
	install -d $(MAN8DIR)
	install -m 0644 $(SERVICE_MANS) $(MAN8DIR)
	for i in $(CLITOOLS); do install -m 0644 -D $$i.bash-completion $(BASHCOMPLDIR)/$$i; done
	for i in $(LIBEXECCLITOOLS); do install -m 0644 -D $$i.bash-completion $(BASHCOMPLDIR)/$$i; done
	for i in $(SERVICES); do install -m 0644 -D $$i.service-bash-completion $(BASHCOMPLDIR)/$$i; done
	for i in $(CLITOOLS); do install -m 0644 -D $$i.zsh-completion $(ZSHCOMPLDIR)/_$$i; done
	for i in $(LIBEXECCLITOOLS); do install -m 0644 -D $$i.zsh-completion $(ZSHCOMPLDIR)/_$$i; done
	for i in $(SERVICES); do install -m 0644 -D $$i.service-zsh-completion $(ZSHCOMPLDIR)/_$$i; done

.PHONY: clean
clean:
	rm -f *.xml.tmp *.1 *.5 *.8 *{synopsis,opts}.adoc docinfo.xml *.tmp
	rm -f *~ *.tmp $(CLI_MANS) $(SERVICE_MANS) *.1.pod *.8.pod
	rm -f *.bash-completion *.service-bash-completion *.zsh-completion *.service-zsh-completion
	rm -f *.api-verified *.service-api-verified
