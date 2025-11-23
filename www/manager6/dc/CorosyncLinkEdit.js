Ext.define('PVE.form.CorosyncLinkEditorController', {
    extend: 'Ext.app.ViewController',
    alias: 'controller.pveCorosyncLinkEditorController',

    addLinkIfEmpty: function () {
        let view = this.getView();
        if (view.items || view.items.length === 0) {
            this.addLink();
        }
    },

    addEmptyLink: function () {
        this.addLink(); // discard parameters to allow being called from 'handler'
    },

    addLink: function (link) {
        let me = this;
        let view = me.getView();
        let vm = view.getViewModel();

        let linkCount = vm.get('linkCount');
        if (linkCount >= vm.get('maxLinkCount')) {
            return;
        }

        link = link || {};

        if (link.number === undefined) {
            link.number = me.getNextFreeNumber();
        }
        if (link.value === undefined) {
            link.value = me.getNextFreeNetwork();
        }

        let linkSelector = Ext.create('PVE.form.CorosyncLinkSelector', {
            maxLinkNumber: vm.get('maxLinkCount') - 1,
            allowNumberEdit: vm.get('allowNumberEdit'),
            allowBlankNetwork: link.allowBlank,
            initNumber: link.number,
            initNetwork: link.value,
            text: link.text,
            emptyText: link.emptyText,

            // needs to be set here, because we need to update the viewmodel
            removeBtnHandler: function () {
                let curLinkCount = vm.get('linkCount');

                if (curLinkCount <= 1) {
                    return;
                }

                vm.set('linkCount', curLinkCount - 1);

                // 'this' is the linkSelector here
                view.remove(this);

                me.updateDeleteButtonState();
            },
        });

        view.add(linkSelector);

        linkCount++;
        vm.set('linkCount', linkCount);

        me.updateDeleteButtonState();
    },

    // ExtJS trips on binding this for some reason, so do it manually
    updateDeleteButtonState: function () {
        let view = this.getView();
        let vm = view.getViewModel();

        let disabled = vm.get('linkCount') <= 1;

        let deleteButtons = view.query('button[cls=removeLinkBtn]');
        Ext.Array.each(deleteButtons, (btn) => {
            btn.setDisabled(disabled);
        });
    },

    getNextFreeNetwork: function () {
        let view = this.getView();
        let vm = view.getViewModel();

        let networksInUse = view.query('proxmoxNetworkSelector').map((selector) => selector.value);

        for (const network of vm.get('networks')) {
            if (!networksInUse.includes(network)) {
                return network;
            }
        }
        return undefined; // default to empty field, user has to set up link manually
    },

    getNextFreeNumber: function () {
        let view = this.getView();
        let vm = view.getViewModel();

        let numbersInUse = view.query('numberfield').map((field) => field.value);

        for (let i = 0; i < vm.get('maxLinkCount'); i++) {
            if (!numbersInUse.includes(i)) {
                return i;
            }
        }
        // all numbers in use, this should never happen since add button is disabled automatically
        return 0;
    },
});

Ext.define('PVE.form.CorosyncLinkSelector', {
    extend: 'Ext.panel.Panel',
    xtype: 'pveCorosyncLinkSelector',

    mixins: ['Proxmox.Mixin.CBind'],
    cbindData: [],

    // config
    maxLinkNumber: 7,
    allowNumberEdit: true,
    allowBlankNetwork: false,
    removeBtnHandler: undefined,
    emptyText: '',

    // values
    initNumber: 0,
    initNetwork: '',
    text: '',

    layout: 'hbox',
    bodyPadding: 5,
    border: 0,

    items: [
        {
            xtype: 'displayfield',
            fieldLabel: 'Link',
            cbind: {
                hidden: '{allowNumberEdit}',
                value: '{initNumber}',
            },
            width: 45,
            labelWidth: 30,
            allowBlank: false,
        },
        {
            xtype: 'numberfield',
            fieldLabel: 'Link',
            cbind: {
                maxValue: '{maxLinkNumber}',
                hidden: '{!allowNumberEdit}',
                value: '{initNumber}',
            },
            width: 80,
            labelWidth: 30,
            minValue: 0,
            submitValue: false, // see getSubmitValue of network selector
            allowBlank: false,
        },
        {
            xtype: 'proxmoxNetworkSelector',
            cbind: {
                allowBlank: '{allowBlankNetwork}',
                value: '{initNetwork}',
                emptyText: '{emptyText}',
            },
            autoSelect: false,
            valueField: 'address',
            displayField: 'address',
            width: 220,
            margin: '0 5px 0 5px',
            getSubmitValue: function () {
                let me = this;
                // link number is encoded into key, so we need to set field name before value retrieval
                let linkNumber = me.prev('numberfield').getValue(); // always the correct one
                me.name = 'link' + linkNumber;
                return me.getValue();
            },
        },
        {
            xtype: 'button',
            iconCls: 'fa fa-trash-o',
            cls: 'removeLinkBtn',
            cbind: {
                hidden: '{!allowNumberEdit}',
            },
            handler: function () {
                let me = this;
                let parent = me.up('pveCorosyncLinkSelector');
                if (parent.removeBtnHandler !== undefined) {
                    parent.removeBtnHandler();
                }
            },
        },
        {
            xtype: 'label',
            margin: '-1px 0 0 5px',

            // for muted effect
            cls: 'x-form-item-label-default',

            cbind: {
                text: '{text}',
            },
        },
    ],

    initComponent: function () {
        let me = this;

        me.callParent();

        let numSelect = me.down('numberfield');
        let netSelect = me.down('proxmoxNetworkSelector');

        numSelect.validator = me.createNoDuplicatesValidator(
            'numberfield',
            gettext('Duplicate link number not allowed.'),
        );

        netSelect.validator = me.createNoDuplicatesValidator(
            'proxmoxNetworkSelector',
            gettext('Duplicate link address not allowed.'),
        );
    },

    createNoDuplicatesValidator: function (queryString, errorMsg) {
        // linkSelector generator
        let view = this;
        /** @this is the field itself, as the validator this is called from scopes it that way */
        return function (val) {
            let me = this;
            let form = view.up('form');
            let linkEditor = view.up('pveCorosyncLinkEditor');

            if (!form.validating) {
                // avoid recursion/double validation by setting temporary states
                me.validating = true;
                form.validating = true;

                // validate all other fields as well, to always mark both
                // parties involved in a 'duplicate' error
                form.isValid();

                form.validating = false;
                me.validating = false;
            } else if (me.validating) {
                // we'll be validated by the original call in the other if-branch, avoid double work
                return true;
            }

            if (val === undefined || (val instanceof String && val.length === 0)) {
                return true; // let this be caught by allowBlank, if at all
            }

            let allFields = linkEditor.query(queryString);
            for (const field of allFields) {
                if (field !== me && String(field.getValue()) === String(val)) {
                    return errorMsg;
                }
            }
            return true;
        };
    },
});

Ext.define('PVE.form.CorosyncLinkEditor', {
    extend: 'Ext.panel.Panel',
    xtype: 'pveCorosyncLinkEditor',

    controller: 'pveCorosyncLinkEditorController',

    // only initial config, use setter otherwise
    allowNumberEdit: true,

    viewModel: {
        data: {
            linkCount: 0,
            maxLinkCount: 8,
            networks: null,
            allowNumberEdit: true,
            infoText: '',
        },
        formulas: {
            addDisabled: function (get) {
                return !get('allowNumberEdit') || get('linkCount') >= get('maxLinkCount');
            },
            dockHidden: function (get) {
                return !(get('allowNumberEdit') || get('infoText'));
            },
        },
    },

    dockedItems: [
        {
            xtype: 'toolbar',
            dock: 'bottom',
            defaultButtonUI: 'default',
            border: false,
            padding: '6 0 6 0',
            bind: {
                hidden: '{dockHidden}',
            },
            items: [
                {
                    xtype: 'button',
                    text: gettext('Add'),
                    bind: {
                        disabled: '{addDisabled}',
                        hidden: '{!allowNumberEdit}',
                    },
                    handler: 'addEmptyLink',
                },
                {
                    xtype: 'label',
                    bind: {
                        text: '{infoText}',
                    },
                },
            ],
        },
    ],

    setInfoText: function (text) {
        let me = this;
        let vm = me.getViewModel();

        vm.set('infoText', text || '');
    },

    setLinks: function (links) {
        let me = this;
        let controller = me.getController();
        let vm = me.getViewModel();

        me.removeAll();
        vm.set('linkCount', 0);

        Ext.Array.each(links, (link) => controller.addLink(link));
    },

    setDefaultLinks: function () {
        let me = this;
        let controller = me.getController();
        let vm = me.getViewModel();

        me.removeAll();
        vm.set('linkCount', 0);
        controller.addLink();
    },

    // clears all links
    setAllowNumberEdit: function (allow) {
        let me = this;
        let vm = me.getViewModel();
        vm.set('allowNumberEdit', allow);
        me.removeAll();
        vm.set('linkCount', 0);
    },

    items: [
        {
            // No links is never a valid scenario, but can occur during a slow load
            xtype: 'hiddenfield',
            submitValue: false,
            isValid: function () {
                let me = this;
                let vm = me.up('pveCorosyncLinkEditor').getViewModel();
                return vm.get('linkCount') > 0;
            },
        },
    ],

    initComponent: function () {
        let me = this;
        let vm = me.getViewModel();
        let controller = me.getController();

        vm.set('allowNumberEdit', me.allowNumberEdit);
        vm.set('infoText', me.infoText || '');

        me.callParent();

        // Request local node networks to pre-populate first link.
        Proxmox.Utils.API2Request({
            url: '/nodes/localhost/network',
            method: 'GET',
            waitMsgTarget: me,
            success: (response) => {
                let data = response.result.data;
                if (data.length > 0) {
                    data.sort((a, b) => a.iface.localeCompare(b.iface));
                    let addresses = [];
                    for (let net of data) {
                        if (net.address) {
                            addresses.push(net.address);
                        }
                        if (net.address6) {
                            addresses.push(net.address6);
                        }
                    }

                    vm.set('networks', addresses);
                }

                // Always have at least one link, but account for delay in API,
                // someone might have called 'setLinks' in the meantime -
                // except if 'allowNumberEdit' is false, in which case we're
                // probably waiting for the user to input the join info
                if (vm.get('allowNumberEdit')) {
                    controller.addLinkIfEmpty();
                }
            },
            failure: () => {
                if (vm.get('allowNumberEdit')) {
                    controller.addLinkIfEmpty();
                }
            },
        });
    },
});
