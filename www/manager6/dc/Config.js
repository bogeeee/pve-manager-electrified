/*
 * Datacenter config panel, located in the center of the ViewPort after the Datacenter view is selected
 */

Ext.define('PVE.dc.Config', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.dc.Config',

    onlineHelp: 'pve_admin_guide',

    initComponent: function () {
        var me = this;

        var caps = Ext.state.Manager.get('GuiCap');

        me.items = [];

        let actionBtn = Ext.create('Ext.Button', {
            text: gettext('Bulk Actions'),
            iconCls: 'fa fa-fw fa-ellipsis-v',
            disabled: !caps.vms['VM.PowerMgmt'] && !caps.vms['VM.Migrate'],
            menu: new Ext.menu.Menu({
                items: [
                    {
                        text: gettext('Bulk Start'),
                        iconCls: 'fa fa-fw fa-play',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                vmsAsArray: true,
                                title: gettext('Bulk Start'),
                                btnText: gettext('Start'),
                                action: 'start',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Shutdown'),
                        iconCls: 'fa fa-fw fa-stop',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                vmsAsArray: true,
                                title: gettext('Bulk Shutdown'),
                                btnText: gettext('Shutdown'),
                                action: 'shutdown',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Suspend'),
                        iconCls: 'fa fa-fw fa-download',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                vmsAsArray: true,
                                title: gettext('Bulk Suspend'),
                                btnText: gettext('Suspend'),
                                action: 'suspend',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Migrate'),
                        iconCls: 'fa fa-fw fa-send-o',
                        disabled: !caps.vms['VM.Migrate'],
                        hidden: PVE.Utils.isStandaloneNode(),
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                vmsAsArray: true,
                                title: gettext('Bulk Migrate'),
                                btnText: gettext('Migrate'),
                                action: 'migrate',
                            });
                        },
                    },
                ],
            }),
        });

        Ext.apply(me, {
            title: gettext('Datacenter'),
            hstateid: 'dctab',
            tbar: [actionBtn],
        });

        if (caps.dc['Sys.Audit']) {
            me.items.push(
                {
                    title: gettext('Summary'),
                    xtype: 'pveDcSummary',
                    iconCls: 'fa fa-book',
                    itemId: 'summary',
                },
                {
                    xtype: 'pmxNotesView',
                    title: gettext('Notes'),
                    iconCls: 'fa fa-sticky-note-o',
                    itemId: 'notes',
                },
                {
                    title: gettext('Cluster'),
                    xtype: 'pveClusterAdministration',
                    iconCls: 'fa fa-server',
                    itemId: 'cluster',
                },
                {
                    title: 'Ceph',
                    itemId: 'ceph',
                    iconCls: 'fa fa-ceph',
                    xtype: 'pveNodeCephStatus',
                },
                {
                    xtype: 'pveDcOptionView',
                    title: gettext('Options'),
                    iconCls: 'fa fa-gear',
                    itemId: 'options',
                },
            );
        }

        if (caps.storage['Datastore.Allocate'] || caps.dc['Sys.Audit']) {
            me.items.push({
                xtype: 'pveStorageView',
                title: gettext('Storage'),
                iconCls: 'fa fa-database',
                itemId: 'storage',
            });
        }

        if (caps.dc['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'pveDcBackupView',
                    iconCls: 'fa fa-floppy-o',
                    title: gettext('Backup'),
                    itemId: 'backup',
                },
                {
                    xtype: 'pveReplicaView',
                    iconCls: 'fa fa-retweet',
                    title: gettext('Replication'),
                    itemId: 'replication',
                },
                {
                    xtype: 'pveACLView',
                    title: gettext('Permissions'),
                    iconCls: 'fa fa-unlock',
                    itemId: 'permissions',
                    expandedOnInit: true,
                },
            );
        }

        me.items.push({
            xtype: 'pveUserView',
            groups: ['permissions'],
            iconCls: 'fa fa-user',
            title: gettext('Users'),
            itemId: 'users',
        });

        me.items.push({
            xtype: 'pveTokenView',
            groups: ['permissions'],
            iconCls: 'fa fa-user-o',
            title: gettext('API Tokens'),
            itemId: 'apitokens',
        });

        me.items.push({
            xtype: 'pmxTfaView',
            title: gettext('Two Factor'),
            groups: ['permissions'],
            iconCls: 'fa fa-key',
            itemId: 'tfa',
            yubicoEnabled: true,
            issuerName: `Proxmox VE - ${PVE.ClusterName || Proxmox.NodeName}`,
        });

        if (caps.dc['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'pveGroupView',
                    title: gettext('Groups'),
                    iconCls: 'fa fa-users',
                    groups: ['permissions'],
                    itemId: 'groups',
                },
                {
                    xtype: 'pvePoolView',
                    title: gettext('Pools'),
                    iconCls: 'fa fa-tags',
                    groups: ['permissions'],
                    itemId: 'pools',
                },
                {
                    xtype: 'pveRoleView',
                    title: gettext('Roles'),
                    iconCls: 'fa fa-male',
                    groups: ['permissions'],
                    itemId: 'roles',
                },
                {
                    title: gettext('Realms'),
                    xtype: 'panel',
                    layout: {
                        type: 'border',
                    },
                    groups: ['permissions'],
                    iconCls: 'fa fa-address-book-o',
                    itemId: 'domains',
                    items: [
                        {
                            xtype: 'pveAuthView',
                            region: 'center',
                            border: false,
                        },
                        {
                            xtype: 'pveRealmSyncJobView',
                            title: gettext('Realm Sync Jobs'),
                            region: 'south',
                            collapsible: true,
                            animCollapse: false,
                            border: false,
                            height: '50%',
                        },
                    ],
                },
                {
                    xtype: 'pveHAStatus',
                    title: 'HA',
                    iconCls: 'fa fa-heartbeat',
                    itemId: 'ha',
                },
                {
                    title: gettext('Affinity Rules'),
                    groups: ['ha'],
                    xtype: 'pveHARulesView',
                    iconCls: 'fa fa-gears',
                    itemId: 'ha-rules',
                },
                {
                    title: gettext('Fencing'),
                    groups: ['ha'],
                    iconCls: 'fa fa-bolt',
                    xtype: 'pveFencingView',
                    itemId: 'ha-fencing',
                },
            );
            // always show on initial load, will be hiddea later if the SDN API calls don't exist,
            // else it won't be shown at first if the user initially loads with DC selected
            if (PVE.SDNInfo || PVE.SDNInfo === undefined) {
                me.items.push(
                    {
                        xtype: 'pveSDNStatus',
                        title: gettext('SDN'),
                        iconCls: 'fa fa-sdn x-fa-sdn-treelist',
                        hidden: true,
                        itemId: 'sdn',
                        expandedOnInit: true,
                    },
                    {
                        xtype: 'pveSDNZoneView',
                        groups: ['sdn'],
                        title: gettext('Zones'),
                        hidden: true,
                        iconCls: 'fa fa-th',
                        itemId: 'sdnzone',
                    },
                    {
                        xtype: 'pveSDNVnet',
                        groups: ['sdn'],
                        title: 'VNets',
                        hidden: true,
                        iconCls: 'fa fa-network-wired x-fa-sdn-treelist',
                        itemId: 'sdnvnet',
                    },
                    {
                        xtype: 'pveSDNOptions',
                        groups: ['sdn'],
                        title: gettext('Options'),
                        hidden: true,
                        iconCls: 'fa fa-gear',
                        itemId: 'sdnoptions',
                    },
                    {
                        xtype: 'pveDhcpTree',
                        groups: ['sdn'],
                        title: gettext('IPAM'),
                        hidden: true,
                        iconCls: 'fa fa-map-signs',
                        itemId: 'sdnmappings',
                    },
                    {
                        xtype: 'pveSDNFirewall',
                        groups: ['sdn'],
                        title: gettext('VNet Firewall'),
                        hidden: true,
                        iconCls: 'fa fa-shield',
                        itemId: 'sdnfirewall',
                    },
                    {
                        xtype: 'pveSDNFabricView',
                        groups: ['sdn'],
                        title: gettext('Fabrics'),
                        hidden: true,
                        iconCls: 'fa fa-road',
                        itemId: 'sdnfabrics',
                    },
                );
            }

            if (Proxmox.UserName === 'root@pam') {
                me.items.push({
                    xtype: 'pveACMEClusterView',
                    title: 'ACME',
                    iconCls: 'fa fa-certificate',
                    itemId: 'acme',
                });
            }

            me.items.push(
                {
                    xtype: 'pveFirewallRules',
                    title: gettext('Firewall'),
                    allow_iface: true,
                    base_url: '/cluster/firewall/rules',
                    list_refs_url: '/cluster/firewall/refs',
                    iconCls: 'fa fa-shield',
                    itemId: 'firewall',
                    firewall_type: 'dc',
                },
                {
                    xtype: 'pveFirewallOptions',
                    title: gettext('Options'),
                    groups: ['firewall'],
                    iconCls: 'fa fa-gear',
                    base_url: '/cluster/firewall/options',
                    onlineHelp: 'pve_firewall_cluster_wide_setup',
                    fwtype: 'dc',
                    itemId: 'firewall-options',
                },
                {
                    xtype: 'pveSecurityGroups',
                    title: gettext('Security Group'),
                    groups: ['firewall'],
                    iconCls: 'fa fa-group',
                    itemId: 'firewall-sg',
                },
                {
                    xtype: 'pveFirewallAliases',
                    title: gettext('Alias'),
                    groups: ['firewall'],
                    iconCls: 'fa fa-external-link',
                    base_url: '/cluster/firewall/aliases',
                    itemId: 'firewall-aliases',
                },
                {
                    xtype: 'pveIPSet',
                    title: 'IPSet',
                    groups: ['firewall'],
                    iconCls: 'fa fa-list-ol',
                    base_url: '/cluster/firewall/ipset',
                    list_refs_url: '/cluster/firewall/refs',
                    itemId: 'firewall-ipset',
                },
                {
                    xtype: 'pveMetricServerView',
                    title: gettext('Metric Server'),
                    iconCls: 'fa fa-bar-chart',
                    itemId: 'metricservers',
                    onlineHelp: 'external_metric_server',
                },
            );
        }

        if (
            caps.mapping['Mapping.Audit'] ||
            caps.mapping['Mapping.Use'] ||
            caps.mapping['Mapping.Modify']
        ) {
            me.items.push(
                {
                    xtype: 'container',
                    onlineHelp: 'resource_mapping',
                    title: gettext('Resource Mappings'),
                    itemId: 'resources',
                    iconCls: 'fa fa-folder-o',
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                        multi: true,
                    },
                    scrollable: true,
                    defaults: {
                        border: false,
                    },
                    items: [
                        {
                            xtype: 'pveDcPCIMapView',
                            title: gettext('PCI Devices'),
                            flex: 1,
                        },
                        {
                            xtype: 'splitter',
                            collapsible: false,
                            performCollapse: false,
                        },
                        {
                            xtype: 'pveDcUSBMapView',
                            title: gettext('USB Devices'),
                            flex: 1,
                        },
                    ],
                },
                {
                    xtype: 'pveDcDirMapView',
                    itemId: 'directories',
                    title: gettext('Directory Mappings'),
                    iconCls: 'fa fa-folder',
                },
            );
        }

        if (
            caps.mapping['Mapping.Audit'] ||
            caps.mapping['Mapping.Use'] ||
            caps.mapping['Mapping.Modify']
        ) {
            me.items.push({
                xtype: 'pmxNotificationConfigView',
                title: gettext('Notifications'),
                itemId: 'notification-targets',
                iconCls: 'fa fa-bell-o',
                baseUrl: '/cluster/notifications',
            });
        }

        if (caps.dc['Sys.Audit']) {
            me.items.push({
                xtype: 'pveDcSupport',
                title: gettext('Support'),
                itemId: 'support',
                iconCls: 'fa fa-comments-o',
            });
        }

        me.callParent();
    },
});
