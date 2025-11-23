Ext.define('PVE.ClusterCreateWindow', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveClusterCreateWindow',

    title: gettext('Create Cluster'),
    width: 600,

    method: 'POST',
    url: '/cluster/config',

    isCreate: true,
    subject: gettext('Cluster'),
    showTaskViewer: true,

    onlineHelp: 'pvecm_create_cluster',

    items: {
        xtype: 'inputpanel',
        items: [
            {
                xtype: 'textfield',
                fieldLabel: gettext('Cluster Name'),
                allowBlank: false,
                maxLength: 15,
                name: 'clustername',
            },
            {
                xtype: 'fieldcontainer',
                fieldLabel: gettext('Cluster Network'),
                items: [
                    {
                        xtype: 'pveCorosyncLinkEditor',
                        infoText: gettext(
                            'Multiple links are used as failover, lower numbers have higher priority.',
                        ),
                        name: 'links',
                    },
                ],
            },
        ],
    },
});

Ext.define('PVE.ClusterInfoWindow', {
    extend: 'Ext.window.Window',
    xtype: 'pveClusterInfoWindow',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 800,
    modal: true,
    resizable: false,
    title: gettext('Cluster Join Information'),

    joinInfo: {
        ipAddress: undefined,
        fingerprint: undefined,
        totem: {},
    },

    items: [
        {
            xtype: 'component',
            border: false,
            padding: '10 10 10 10',
            html: gettext('Copy the Join Information here and use it on the node you want to add.'),
        },
        {
            xtype: 'container',
            layout: 'form',
            border: false,
            padding: '0 10 10 10',
            items: [
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('IP Address'),
                    cbind: {
                        value: '{joinInfo.ipAddress}',
                    },
                    editable: false,
                },
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Fingerprint'),
                    cbind: {
                        value: '{joinInfo.fingerprint}',
                    },
                    editable: false,
                },
                {
                    xtype: 'textarea',
                    inputId: 'pveSerializedClusterInfo',
                    fieldLabel: gettext('Join Information'),
                    grow: true,
                    cbind: {
                        joinInfo: '{joinInfo}',
                    },
                    editable: false,
                    listeners: {
                        afterrender: function (field) {
                            if (!field.joinInfo) {
                                return;
                            }
                            var jsons = Ext.JSON.encode(field.joinInfo);
                            var base64s = Ext.util.Base64.encode(jsons);
                            field.setValue(base64s);
                        },
                    },
                },
            ],
        },
    ],
    dockedItems: [
        {
            dock: 'bottom',
            xtype: 'toolbar',
            items: [
                {
                    xtype: 'button',
                    handler: function (b) {
                        var el = document.getElementById('pveSerializedClusterInfo');
                        el.select();
                        document.execCommand('copy');
                    },
                    text: gettext('Copy Information'),
                    iconCls: 'fa fa-clipboard',
                },
            ],
        },
    ],
});

Ext.define('PVE.ClusterJoinNodeWindow', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveClusterJoinNodeWindow',

    title: gettext('Cluster Join'),
    width: 800,

    method: 'POST',
    url: '/cluster/config/join',

    defaultFocus: 'textarea[name=serializedinfo]',
    isCreate: true,
    bind: {
        submitText: '{submittxt}',
    },
    showTaskViewer: true,

    onlineHelp: 'pvecm_join_node_to_cluster',

    viewModel: {
        parent: null,
        data: {
            info: {
                fp: '',
                ip: '',
                clusterName: '',
            },
            hasAssistedInfo: false,
        },
        formulas: {
            submittxt: function (get) {
                let cn = get('info.clusterName');
                if (cn) {
                    return Ext.String.format(gettext('Join {0}'), `'${cn}'`);
                }
                return gettext('Join');
            },
            showClusterFields: (get) => {
                let manualMode = !get('assistedEntry.checked');
                return get('hasAssistedInfo') || manualMode;
            },
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            '#': {
                close: function () {
                    delete PVE.Utils.silenceAuthFailures;
                },
            },
            'proxmoxcheckbox[name=assistedEntry]': {
                change: 'onInputTypeChange',
            },
            'textarea[name=serializedinfo]': {
                change: 'recomputeSerializedInfo',
                enable: 'resetField',
            },
            textfield: {
                disable: 'resetField',
            },
        },
        resetField: function (field) {
            field.reset();
        },
        onInputTypeChange: function (field, assistedInput) {
            let linkEditor = this.lookup('linkEditor');

            // this also clears all links
            linkEditor.setAllowNumberEdit(!assistedInput);

            if (!assistedInput) {
                linkEditor.setInfoText();
                linkEditor.setDefaultLinks();
            }
        },
        recomputeSerializedInfo: function (field, value) {
            let vm = this.getViewModel();

            let assistedEntryBox = this.lookup('assistedEntry');

            if (!assistedEntryBox.getValue()) {
                // not in assisted entry mode, nothing to do
                vm.set('hasAssistedInfo', false);
                return;
            }

            let linkEditor = this.lookup('linkEditor');

            let jsons = Ext.util.Base64.decode(value);
            let joinInfo = Ext.JSON.decode(jsons, true);

            let info = {
                fp: '',
                ip: '',
                clusterName: '',
            };

            if (!(joinInfo && joinInfo.totem)) {
                field.valid = false;
                linkEditor.setLinks([]);
                linkEditor.setInfoText();
                vm.set('hasAssistedInfo', false);
            } else {
                let interfaces = joinInfo.totem.interface;
                let links = Object.values(interfaces).map((iface) => {
                    let linkNumber = iface.linknumber;
                    let peerLink;
                    if (joinInfo.peerLinks) {
                        peerLink = joinInfo.peerLinks[linkNumber];
                    }
                    return {
                        number: linkNumber,
                        value: '',
                        text: peerLink
                            ? Ext.String.format(gettext("peer's link address: {0}"), peerLink)
                            : '',
                        allowBlank: false,
                    };
                });

                linkEditor.setInfoText();
                if (
                    links.length === 1 &&
                    joinInfo.ring_addr !== undefined &&
                    joinInfo.ring_addr[0] === joinInfo.ipAddress
                ) {
                    links[0].allowBlank = true;
                    links[0].emptyText = gettext("IP resolved by node's hostname");
                }

                linkEditor.setLinks(links);

                info = {
                    ip: joinInfo.ipAddress,
                    fp: joinInfo.fingerprint,
                    clusterName: joinInfo.totem.cluster_name,
                };
                field.valid = true;
                vm.set('hasAssistedInfo', true);
            }
            vm.set('info', info);
        },
    },

    submit: function () {
        // joining may produce temporarily auth failures, ignore as long the task runs
        PVE.Utils.silenceAuthFailures = true;
        this.callParent();
    },

    taskDone: function (success) {
        delete PVE.Utils.silenceAuthFailures;
        if (success) {
            // reload always (if user wasn't faster), but wait a bit for pveproxy
            Ext.defer(function () {
                window.location.reload(true);
            }, 5000);
            let txt = gettext(
                'Cluster join task finished, node certificate may have changed, reload GUI!',
            );
            // ensure user cannot do harm
            Ext.getBody().mask(txt, ['pve-static-mask']);
            // TaskView may hide above mask, so tell him directly
            Ext.Msg.show({
                title: gettext('Join Task Finished'),
                icon: Ext.Msg.INFO,
                msg: txt,
            });
        }
    },

    items: [
        {
            xtype: 'proxmoxcheckbox',
            reference: 'assistedEntry',
            name: 'assistedEntry',
            itemId: 'assistedEntry',
            submitValue: false,
            value: true,
            autoEl: {
                tag: 'div',
                'data-qtip': gettext(
                    'Select if join information should be extracted from pasted cluster information, deselect for manual entering',
                ),
            },
            boxLabel: gettext(
                'Assisted join: Paste encoded cluster join information and enter password.',
            ),
        },
        {
            xtype: 'textarea',
            name: 'serializedinfo',
            submitValue: false,
            allowBlank: false,
            fieldLabel: gettext('Information'),
            emptyText: gettext('Paste encoded Cluster Information here'),
            validator: function (val) {
                return (
                    val === '' ||
                    this.valid ||
                    gettext('Does not seem like a valid encoded Cluster Information!')
                );
            },
            bind: {
                disabled: '{!assistedEntry.checked}',
                hidden: '{!assistedEntry.checked}',
            },
            value: '',
        },
        {
            xtype: 'panel',
            width: 776,
            layout: {
                type: 'hbox',
                align: 'center',
            },
            bind: {
                hidden: '{!showClusterFields}',
            },
            items: [
                {
                    xtype: 'textfield',
                    flex: 1,
                    margin: '0 5px 0 0',
                    fieldLabel: gettext('Peer Address'),
                    allowBlank: false,
                    bind: {
                        value: '{info.ip}',
                        readOnly: '{assistedEntry.checked}',
                    },
                    name: 'hostname',
                },
                {
                    xtype: 'textfield',
                    flex: 1,
                    margin: '0 0 10px 5px',
                    inputType: 'password',
                    emptyText: gettext("Peer's root password"),
                    fieldLabel: gettext('Password'),
                    allowBlank: false,
                    name: 'password',
                },
            ],
        },
        {
            xtype: 'textfield',
            fieldLabel: gettext('Fingerprint'),
            allowBlank: false,
            bind: {
                value: '{info.fp}',
                readOnly: '{assistedEntry.checked}',
                hidden: '{!showClusterFields}',
            },
            name: 'fingerprint',
        },
        {
            xtype: 'fieldcontainer',
            fieldLabel: gettext('Cluster Network'),
            bind: {
                hidden: '{!showClusterFields}',
            },
            items: [
                {
                    xtype: 'pveCorosyncLinkEditor',
                    itemId: 'linkEditor',
                    reference: 'linkEditor',
                    allowNumberEdit: false,
                },
            ],
        },
    ],
});
