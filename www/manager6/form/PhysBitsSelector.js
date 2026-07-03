Ext.define('PVE.form.PhysBitsSelector', {
    extend: 'Ext.form.FieldContainer',
    alias: 'widget.PhysBitsSelector',
    mixins: ['Ext.form.field.Field'],

    layout: 'vbox',
    originalValue: '',

    controller: {
        xclass: 'Ext.app.ViewController',

        onRadioChange: function (radio, value) {
            let me = this;
            if (value === undefined) {
                return;
            }

            ['modeDefault', 'modeHost', 'modeCustom'].forEach(function (ref) {
                let r = me.lookupReference(ref);
                if (r !== radio) {
                    r.suspendEvents();
                    r.setValue(false);
                    r.resumeEvents();
                }
            });

            me.updateNumberField();
        },

        updateNumberField: function () {
            let me = this;
            let modeCustom = me.lookupReference('modeCustom');
            let customNum = me.lookupReference('customNum');

            customNum.setDisabled(!modeCustom.getValue());
            me.getView().validate();
        },

        listen: {
            component: {
                '*': {
                    change: function () {
                        let me = this;
                        me.getView().checkChange();
                    },
                },
            },
        },
    },

    getValue: function () {
        let me = this;
        let ctrl = me.getController();
        if (ctrl.lookupReference('modeDefault').getValue()) {
            return '';
        } else if (ctrl.lookupReference('modeHost').getValue()) {
            return 'host';
        } else if (ctrl.lookupReference('modeCustom').getValue()) {
            return ctrl.lookupReference('customNum').getValue();
        }
        return ''; // shouldn't happen
    },

    setValue: function (value) {
        let me = this;
        let ctrl = me.getController();
        let modeField;

        if (!value) {
            modeField = ctrl.lookupReference('modeDefault');
        } else if (value === 'host') {
            modeField = ctrl.lookupReference('modeHost');
        } else {
            let customNum = ctrl.lookupReference('customNum');
            customNum.setValue(value);
            modeField = ctrl.lookupReference('modeCustom');
        }

        modeField.setValue(true);
        me.checkChange();

        return value;
    },

    getErrors: function () {
        let me = this;
        let ctrl = me.getController();
        if (ctrl.lookupReference('modeCustom').getValue()) {
            return ctrl.lookupReference('customNum').getErrors();
        }
        return [];
    },

    isValid: function () {
        let me = this;
        let ctrl = me.getController();
        if (ctrl.lookupReference('modeCustom').getValue()) {
            return ctrl.lookupReference('customNum').isValid();
        }
        return true;
    },

    items: [
        {
            xtype: 'radiofield',
            boxLabel: gettext('Default from QEMU'),
            inputValue: 'default',
            checked: true,
            reference: 'modeDefault',
            listeners: {
                change: 'onRadioChange',
            },
            isFormField: false,
        },
        {
            xtype: 'radiofield',
            boxLabel: gettext('Inherit from host CPU'),
            inputValue: 'host',
            reference: 'modeHost',
            listeners: {
                change: 'onRadioChange',
            },
            isFormField: false,
        },
        {
            xtype: 'fieldcontainer',
            layout: 'hbox',
            items: [
                {
                    xtype: 'radiofield',
                    boxLabel: gettext('Custom value'),
                    inputValue: 'custom',
                    listeners: {
                        change: 'onRadioChange',
                    },
                    reference: 'modeCustom',
                    isFormField: false,
                },
                {
                    xtype: 'numberfield',
                    width: 60,
                    margin: '0 0 0 10px',
                    minValue: 8,
                    maxValue: 64,
                    reference: 'customNum',
                    allowBlank: false,
                    isFormField: false,
                    disabled: true,
                },
            ],
        },
    ],
});
