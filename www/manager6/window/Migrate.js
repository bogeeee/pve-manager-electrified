Ext.define('PVE.window.Migrate', {
    extend: 'Ext.window.Window',

    vmtype: undefined,
    nodename: undefined,
    vmid: undefined,
    vmname: undefined,
    maxHeight: 450,

    viewModel: {
        data: {
            vmid: undefined,
            nodename: undefined,
            vmtype: undefined,
            running: false,
            qemu: {
                onlineHelp: 'qm_migration',
                commonName: 'VM',
            },
            lxc: {
                onlineHelp: 'pct_migration',
                commonName: 'CT',
            },
            migration: {
                possible: true,
                preconditions: [],
                'with-local-disks': 0,
                mode: undefined,
                allowedNodes: undefined,
                overwriteLocalResourceCheck: false,
                hasLocalResources: false,
                withConntrackState: true,
                bothHaveDbusVmstate: false,
            },
        },
        formulas: {
            setMigrationMode: function (get) {
                if (get('running')) {
                    if (get('vmtype') === 'qemu') {
                        return gettext('Online');
                    } else {
                        return gettext('Restart Mode');
                    }
                } else {
                    return gettext('Offline');
                }
            },
            setStorageselectorHidden: function (get) {
                if (get('migration.with-local-disks') && get('running')) {
                    return false;
                } else {
                    return true;
                }
            },
            setLocalResourceCheckboxHidden: function (get) {
                if (
                    get('running') ||
                    !get('migration.hasLocalResources') ||
                    Proxmox.UserName !== 'root@pam'
                ) {
                    return true;
                } else {
                    return false;
                }
            },
            conntrackStateCheckboxHidden: (get) =>
                !get('running') ||
                get('vmtype') !== 'qemu' ||
                !get('migration.bothHaveDbusVmstate'),
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            'panel[reference=formPanel]': {
                validityChange: function (panel, isValid) {
                    this.getViewModel().set('migration.possible', isValid);
                    this.checkMigratePreconditions();
                },
            },
        },

        init: function (view) {
            var me = this,
                vm = view.getViewModel();

            if (!view.nodename) {
                throw 'missing custom view config: nodename';
            }
            vm.set('nodename', view.nodename);

            if (!view.vmid) {
                throw 'missing custom view config: vmid';
            }
            vm.set('vmid', view.vmid);

            if (!view.vmtype) {
                throw 'missing custom view config: vmtype';
            }
            vm.set('vmtype', view.vmtype);

            let title = Ext.String.format(
                '{0} {1} {2}',
                gettext('Migrate'),
                vm.get(view.vmtype).commonName,
                PVE.Utils.getFormattedGuestIdentifier(view.vmid, view.vmname),
            );
            view.setTitle(title);

            me.lookup('proxmoxHelpButton').setHelpConfig({
                onlineHelp: vm.get(view.vmtype).onlineHelp,
            });
            me.lookup('formPanel').isValid();
        },

        onTargetChange: function (nodeSelector) {
            // Always display the storages of the currently selected migration target
            this.lookup('pveDiskStorageSelector').setNodename(nodeSelector.value);
            this.checkMigratePreconditions(true);
        },

        startMigration: function () {
            var me = this,
                view = me.getView(),
                vm = me.getViewModel();

            var values = me.lookup('formPanel').getValues();
            var params = {
                target: values.target,
            };

            if (vm.get('migration.mode')) {
                params[vm.get('migration.mode')] = 1;
            }
            if (vm.get('migration.with-local-disks')) {
                params['with-local-disks'] = 1;
            }
            //offline migration to a different storage currently might fail at a late stage
            //(i.e. after some disks have been moved), so don't expose it yet in the GUI
            if (vm.get('migration.with-local-disks') && vm.get('running') && values.targetstorage) {
                params.targetstorage = values.targetstorage;
            }

            if (vm.get('migration.overwriteLocalResourceCheck')) {
                params.force = 1;
            }

            if (vm.get('migration.bothHaveDbusVmstate') && vm.get('migration.withConntrackState')) {
                params['with-conntrack-state'] = 1;
            }

            Proxmox.Utils.API2Request({
                params: params,
                url:
                    '/nodes/' +
                    vm.get('nodename') +
                    '/' +
                    vm.get('vmtype') +
                    '/' +
                    vm.get('vmid') +
                    '/migrate',
                waitMsgTarget: view,
                method: 'POST',
                failure: function (response, opts) {
                    Ext.Msg.alert(Proxmox.Utils.errorText, response.htmlStatus);
                },
                success: function (response, options) {
                    var upid = response.result.data;
                    var extraTitle = Ext.String.format(
                        ' ({0} ---> {1})',
                        vm.get('nodename'),
                        params.target,
                    );

                    Ext.create('Proxmox.window.TaskViewer', {
                        upid: upid,
                        extraTitle: extraTitle,
                    }).show();

                    view.close();
                },
            });
        },

        checkMigratePreconditions: async function (resetMigrationPossible) {
            var me = this,
                vm = me.getViewModel();

            var vmrec = PVE.data.ResourceStore.findRecord(
                'vmid',
                vm.get('vmid'),
                0,
                false,
                false,
                true,
            );
            if (vmrec && vmrec.data && vmrec.data.running) {
                vm.set('running', true);
            }

            me.lookup('pveNodeSelector').disallowedNodes = [vm.get('nodename')];

            if (vm.get('vmtype') === 'qemu') {
                await me.checkQemuPreconditions(resetMigrationPossible);
            } else {
                await me.checkLxcPreconditions(resetMigrationPossible);
            }

            // Only allow nodes where the local storage is available in case of offline migration
            // where storage migration is not possible
            me.lookup('pveNodeSelector').allowedNodes = vm.get('migration.allowedNodes');

            me.lookup('formPanel').isValid();
        },

        checkQemuPreconditions: async function (resetMigrationPossible) {
            let me = this,
                vm = me.getViewModel(),
                migrateStats;

            if (vm.get('running')) {
                vm.set('migration.mode', 'online');
            }

            try {
                if (
                    me.fetchingNodeMigrateInfo &&
                    me.fetchingNodeMigrateInfo === vm.get('nodename')
                ) {
                    return;
                }
                me.fetchingNodeMigrateInfo = vm.get('nodename');
                let { result } = await Proxmox.Async.api2({
                    url: `/nodes/${vm.get('nodename')}/${vm.get('vmtype')}/${vm.get('vmid')}/migrate`,
                    method: 'GET',
                });
                migrateStats = result.data;
            } catch (error) {
                if (error?.result?.status !== 501) {
                    Ext.Msg.alert(Proxmox.Utils.errorText, error.htmlStatus);
                }
                me.fetchingNodeMigrateInfo = false;
                return;
            }

            const target = me.lookup('pveNodeSelector').value;
            let targetCapabilities = {};

            try {
                const { result } = await Proxmox.Async.api2({
                    url: `/nodes/${target}/capabilities/qemu/migration`,
                    method: 'GET',
                });
                targetCapabilities = result.data;
            } catch (err) {
                // Only emit a warning in the case the target node does not (yet) support the
                // `capabilites/qemu/migration` endpoint and simply treat all features as unsupported.
                console.warn(`failed to query /capabilites/qemu/migration on '${target}':`, err);
            }

            me.fetchingNodeMigrateInfo = false;

            if (migrateStats.running) {
                vm.set('running', true);
            }
            // Get migration object from viewmodel to prevent to many bind callbacks
            let migration = vm.get('migration');
            if (resetMigrationPossible) {
                migration.possible = true;
            }
            migration.preconditions = [];
            let disallowed = migrateStats.not_allowed_nodes?.[target] ?? {};

            if (migrateStats.allowed_nodes && !vm.get('running')) {
                migration.allowedNodes = migrateStats.allowed_nodes;
                if (target.length && !migrateStats.allowed_nodes.includes(target)) {
                    if (disallowed.unavailable_storages !== undefined) {
                        let missingStorages = disallowed.unavailable_storages.join(', ');
                        const text = Ext.String.format(
                            gettext(
                                'Storage(s) ({0}) not available on selected target. Start VM to use live storage migration or select other target node.',
                            ),
                            missingStorages,
                        );

                        migration.possible = false;
                        migration.preconditions.push({ text, severity: 'error' });
                    }
                }
            }

            if (disallowed['unavailable-resources'] !== undefined) {
                let unavailableResources = disallowed['unavailable-resources'].join(', ');
                const text = Ext.String.format(
                    gettext('Mapped Resources ({0}) not available on selected target.'),
                    unavailableResources,
                );

                migration.possible = false;
                migration.preconditions.push({ text, severity: 'error' });
            }

            let blockingResources = [];
            let mappedResources = migrateStats['mapped-resource-info'] ?? {};

            for (const res of migrateStats.local_resources) {
                if (!mappedResources[res]) {
                    blockingResources.push(res);
                }
            }

            if (blockingResources.length) {
                migration.hasLocalResources = true;
                if (!migration.overwriteLocalResourceCheck || vm.get('running')) {
                    const text = Ext.String.format(
                        gettext('Cannot migrate VM with local resources: {0}'),
                        blockingResources.join(', '),
                    );

                    migration.possible = false;
                    migration.preconditions.push({ text, severity: 'error' });
                } else {
                    const text = Ext.String.format(
                        gettext(
                            'Migrating VM with local resources: {0}. This might fail if the resources are not available on the target node.',
                        ),
                        blockingResources.join(', '),
                    );

                    migration.preconditions.push({ text, severity: 'warning' });
                }
            }

            if (vm.get('running')) {
                let allowed = [];
                let notAllowed = [];
                for (const [key, resource] of Object.entries(mappedResources)) {
                    if (resource['live-migration']) {
                        allowed.push(key);
                    } else {
                        notAllowed.push(key);
                    }
                }
                if (notAllowed.length > 0) {
                    const text = Ext.String.format(
                        gettext('Cannot migrate running VM with mapped resources: {0}'),
                        notAllowed.join(', '),
                    );

                    migration.possible = false;
                    migration.preconditions.push({ text, severity: 'error' });
                } else if (allowed.length > 0) {
                    const text = Ext.String.format(
                        gettext(
                            'Live-migrating running VM with mapped resources (Experimental): {0}',
                        ),
                        allowed.join(', '),
                    );

                    migration.preconditions.push({ text, severity: 'warning' });
                }
            }

            if (migrateStats.local_disks.length) {
                migrateStats.local_disks.forEach(function (disk) {
                    if (disk.cdrom && disk.cdrom === 1) {
                        if (!disk.volid.includes('vm-' + vm.get('vmid') + '-cloudinit')) {
                            migration.possible = false;
                            migration.preconditions.push({
                                text: gettext('Cannot migrate VM with local CD/DVD'),
                                severity: 'error',
                            });
                        }
                    } else {
                        let size = disk.size
                            ? '(' + Proxmox.Utils.render_size(disk.size) + ')'
                            : '';
                        const text = Ext.String.format(
                            gettext('Migration with local disk might take long: {0} {1}'),
                            disk.volid,
                            size,
                        );

                        migration['with-local-disks'] = 1;
                        migration.preconditions.push({ text, severity: 'warning' });
                    }
                });
            }

            migration.bothHaveDbusVmstate =
                migrateStats['has-dbus-vmstate'] && targetCapabilities['has-dbus-vmstate'];
            if (vm.get('running')) {
                if (migration.withConntrackState && !migrateStats['has-dbus-vmstate']) {
                    migration.preconditions.push({
                        text: gettext(
                            'Cannot migrate conntrack state, source node is lacking support.',
                        ),
                        // user cannot really do anything about this, do not bother with scaring them!
                        severity: 'info',
                    });
                }
                if (migration.withConntrackState && !targetCapabilities['has-dbus-vmstate']) {
                    migration.preconditions.push({
                        text: gettext(
                            'Cannot migrate conntrack state, target node is lacking support. Active network connections might get dropped.',
                        ),
                        severity: 'warning',
                    });
                }

                if (migration.bothHaveDbusVmstate && !migration.withConntrackState) {
                    migration.preconditions.push({
                        text: gettext(
                            'Conntrack state migration disabled. Active network connections might get dropped.',
                        ),
                        severity: 'warning',
                    });
                }
            }

            let blockingHAResources = disallowed['blocking-ha-resources'] ?? [];
            if (blockingHAResources.length) {
                migration.possible = false;

                for (const { sid, cause } of blockingHAResources) {
                    let reasonText;
                    if (cause === 'resource-affinity') {
                        reasonText = Ext.String.format(
                            gettext(
                                'HA resource {0} with negative affinity to VM on selected target node',
                            ),
                            sid,
                        );
                    } else {
                        reasonText = Ext.String.format(
                            gettext('blocking HA resource {0} on selected target node'),
                            sid,
                        );
                    }

                    migration.preconditions.push({
                        severity: 'error',
                        text: Ext.String.format(
                            gettext('Cannot migrate VM, because {0}.'),
                            reasonText,
                        ),
                    });
                }
            }

            let dependentHAResources = migrateStats['dependent-ha-resources'];
            if (dependentHAResources !== undefined) {
                for (const sid of dependentHAResources) {
                    const text = Ext.String.format(
                        gettext(
                            'HA resource {0} with positive affinity to VM is also migrated to selected target node.',
                        ),
                        sid,
                    );

                    migration.preconditions.push({ text, severity: 'warning' });
                }
            }

            vm.set('migration', migration);
        },
        checkLxcPreconditions: async function (resetMigrationPossible) {
            let me = this;
            let vm = me.getViewModel();
            let migrateStats;

            if (vm.get('running')) {
                vm.set('migration.mode', 'restart');
            }

            try {
                if (
                    me.fetchingNodeMigrateInfo &&
                    me.fetchingNodeMigrateInfo === vm.get('nodename')
                ) {
                    return;
                }
                me.fetchingNodeMigrateInfo = vm.get('nodename');
                let { result } = await Proxmox.Async.api2({
                    url: `/nodes/${vm.get('nodename')}/${vm.get('vmtype')}/${vm.get('vmid')}/migrate`,
                    method: 'GET',
                });
                migrateStats = result.data;
                me.fetchingNodeMigrateInfo = false;
            } catch (error) {
                if (error?.result?.status !== 501) {
                    Ext.Msg.alert(Proxmox.Utils.errorText, error.htmlStatus);
                }
                me.fetchingNodeMigrateInfo = false;
                return;
            }

            if (migrateStats.running) {
                vm.set('running', true);
            }

            // Get migration object from viewmodel to prevent to many bind callbacks
            let migration = vm.get('migration');
            if (resetMigrationPossible) {
                migration.possible = true;
            }
            migration.preconditions = [];
            let targetNode = me.lookup('pveNodeSelector').value;
            let disallowed = migrateStats['not-allowed-nodes']?.[targetNode] ?? {};

            let blockingHAResources = disallowed['blocking-ha-resources'] ?? [];
            if (blockingHAResources.length) {
                migration.possible = false;

                for (const { sid, cause } of blockingHAResources) {
                    let reasonText;
                    if (cause === 'resource-affinity') {
                        reasonText = Ext.String.format(
                            gettext(
                                'HA resource {0} with negative affinity to container on selected target node',
                            ),
                            sid,
                        );
                    } else {
                        reasonText = Ext.String.format(
                            gettext('blocking HA resource {0} on selected target node'),
                            sid,
                        );
                    }

                    migration.preconditions.push({
                        severity: 'error',
                        text: Ext.String.format(
                            gettext('Cannot migrate container, because {0}.'),
                            reasonText,
                        ),
                    });
                }
            }

            let dependentHAResources = migrateStats['dependent-ha-resources'];
            if (dependentHAResources !== undefined) {
                for (const sid of dependentHAResources) {
                    const text = Ext.String.format(
                        gettext(
                            'HA resource {0} with positive affinity to container is also migrated to selected target node.',
                        ),
                        sid,
                    );

                    migration.preconditions.push({ text, severity: 'warning' });
                }
            }

            vm.set('migration', migration);
        },
    },

    width: 600,
    modal: true,
    layout: {
        type: 'vbox',
        align: 'stretch',
    },
    border: false,
    items: [
        {
            xtype: 'form',
            reference: 'formPanel',
            bodyPadding: 10,
            border: false,
            layout: 'hbox',
            items: [
                {
                    xtype: 'container',
                    flex: 1,
                    items: [
                        {
                            xtype: 'displayfield',
                            name: 'source',
                            fieldLabel: gettext('Source node'),
                            bind: {
                                value: '{nodename}',
                            },
                        },
                        {
                            xtype: 'displayfield',
                            reference: 'migrationMode',
                            fieldLabel: gettext('Mode'),
                            bind: {
                                value: '{setMigrationMode}',
                            },
                        },
                    ],
                },
                {
                    xtype: 'container',
                    flex: 1,
                    items: [
                        {
                            xtype: 'pveNodeSelector',
                            reference: 'pveNodeSelector',
                            name: 'target',
                            fieldLabel: gettext('Target node'),
                            allowBlank: false,
                            disallowedNodes: undefined,
                            onlineValidator: true,
                            listeners: {
                                change: 'onTargetChange',
                            },
                        },
                        {
                            xtype: 'pveStorageSelector',
                            reference: 'pveDiskStorageSelector',
                            name: 'targetstorage',
                            fieldLabel: gettext('Target storage'),
                            storageContent: 'images',
                            allowBlank: true,
                            autoSelect: false,
                            emptyText: gettext('Current layout'),
                            bind: {
                                hidden: '{setStorageselectorHidden}',
                            },
                        },
                        {
                            xtype: 'proxmoxcheckbox',
                            name: 'overwriteLocalResourceCheck',
                            fieldLabel: gettext('Force'),
                            autoEl: {
                                tag: 'div',
                                'data-qtip': gettext('Overwrite local resources unavailable check'),
                            },
                            bind: {
                                hidden: '{setLocalResourceCheckboxHidden}',
                                value: '{migration.overwriteLocalResourceCheck}',
                            },
                            listeners: {
                                change: {
                                    fn: 'checkMigratePreconditions',
                                    extraArg: true,
                                },
                            },
                        },
                        {
                            xtype: 'proxmoxcheckbox',
                            name: 'withConntrackState',
                            // TRANSLATORS: See https://www.kernel.org/doc/html/next/networking/netlink_spec/conntrack.html
                            fieldLabel: gettext('Conntrack state'),
                            autoEl: {
                                tag: 'div',
                                'data-qtip': gettext(
                                    'Enables live migration of conntrack entries for this VM.',
                                ),
                            },
                            bind: {
                                hidden: '{conntrackStateCheckboxHidden}',
                                value: '{migration.withConntrackState}',
                            },
                            listeners: {
                                change: {
                                    fn: 'checkMigratePreconditions',
                                    extraArg: true,
                                },
                            },
                        },
                    ],
                },
            ],
        },
        {
            xtype: 'gridpanel',
            reference: 'preconditionGrid',
            selectable: false,
            flex: 1,
            columns: [
                {
                    text: '',
                    dataIndex: 'severity',
                    renderer: function (v) {
                        switch (v) {
                            case 'warning':
                                return '<i class="fa fa-exclamation-triangle warning"></i> ';
                            case 'error':
                                return '<i class="fa fa-times critical"></i>';
                            case 'info':
                                return '<i class="fa fa-info-circle info-blue"></i>';
                            default:
                                return v;
                        }
                    },
                    width: 35,
                },
                {
                    text: 'Info',
                    dataIndex: 'text',
                    cellWrap: true,
                    flex: 1,
                },
            ],
            bind: {
                hidden: '{!migration.preconditions.length}',
                store: {
                    fields: ['severity', 'text'],
                    data: '{migration.preconditions}',
                    sorters: 'text',
                },
            },
        },
    ],
    buttons: [
        {
            xtype: 'proxmoxHelpButton',
            reference: 'proxmoxHelpButton',
            onlineHelp: 'pct_migration',
            listenToGlobalEvent: false,
            hidden: false,
        },
        '->',
        {
            xtype: 'button',
            reference: 'submitButton',
            text: gettext('Migrate'),
            handler: 'startMigration',
            bind: {
                disabled: '{!migration.possible}',
            },
        },
    ],
});
